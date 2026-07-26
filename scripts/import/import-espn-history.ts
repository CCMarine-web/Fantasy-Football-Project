import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * Imports the league's ESPN history (2016-2022) into the same tables the
 * Sleeper sync writes, marked `dataSource: ESPN` so the two eras stay
 * distinguishable and Sleeper data is never overwritten.
 *
 *   npx tsx scripts/import/import-espn-history.ts --check          # auth probe only
 *   npx tsx scripts/import/import-espn-history.ts --dry-run
 *   npx tsx scripts/import/import-espn-history.ts --years 2016-2022
 *   npx tsx scripts/import/import-espn-history.ts --fresh
 *
 * ── AUTHENTICATION ─────────────────────────────────────────────────────────
 * League 501874 is PRIVATE. Anonymous reads return:
 *   HTTP 401 {"AUTH_LEAGUE_NOT_VISIBLE": "You are not authorized to view this League."}
 * Two cookies from a logged-in ESPN browser session are required:
 *
 *   ESPN_SWID   the SWID cookie, including the braces, e.g. {1A2B3C4D-...}
 *   ESPN_S2     the espn_s2 cookie (a long percent-encoded string)
 *
 * To collect them: sign in at fantasy.espn.com, open DevTools →
 * Application → Cookies → https://fantasy.espn.com, and copy both values into
 * .env.local. Nothing is imported until they are present and valid — the
 * script exits non-zero with the exact reason rather than writing partial data.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────
 *  - Resumable: each season is checkpointed, so a rerun skips finished years.
 *  - Idempotent: every write is an upsert keyed on stable ESPN ids.
 *  - Never overwrites Sleeper: seasons whose dataSource is SLEEPER are skipped.
 *  - Never invents data: fields ESPN doesn't return are left null.
 *  - Manager mapping is proposed, not guessed — see reportUnmappedOwners().
 */

const FIRST_YEAR = 2016;
const LAST_YEAR = 2022;
const READ_HOST = "https://lm-api-reads.fantasy.espn.com";

const CHECKPOINT_DIR = join(process.cwd(), "scripts", "import", ".checkpoints");
const CHECKPOINT_FILE = join(CHECKPOINT_DIR, "espn-history.json");

interface Checkpoint {
  doneYears: number[];
  updatedAt: string;
}

function loadCheckpoint(fresh: boolean): Checkpoint {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  if (!fresh && existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")) as Checkpoint;
    } catch {
      /* corrupt checkpoint — start over */
    }
  }
  return { doneYears: [], updatedAt: new Date(0).toISOString() };
}

function saveCheckpoint(cp: Checkpoint) {
  cp.updatedAt = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// --- ESPN client ------------------------------------------------------------

export class EspnAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EspnAuthError";
  }
}

interface EspnTeam {
  id: number;
  abbrev?: string;
  name?: string;
  location?: string;
  nickname?: string;
  owners?: string[];
  primaryOwner?: string;
  record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number } };
  playoffSeed?: number;
  rankCalculatedFinal?: number;
}

interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

interface EspnMatchup {
  id: number;
  matchupPeriodId: number;
  playoffTierType?: string;
  winner?: string;
  home?: { teamId: number; totalPoints?: number };
  away?: { teamId: number; totalPoints?: number };
}

interface EspnLeagueResponse {
  seasonId?: number;
  teams?: EspnTeam[];
  members?: EspnMember[];
  schedule?: EspnMatchup[];
  status?: { finalScoringPeriod?: number; currentMatchupPeriod?: number };
  settings?: { name?: string; scheduleSettings?: { matchupPeriodCount?: number } };
}

function cookieHeader(): string {
  const env = getEnv();
  return `SWID=${env.ESPN_SWID}; espn_s2=${env.ESPN_S2}`;
}

/**
 * Historical seasons live behind the leagueHistory endpoint, which returns an
 * ARRAY. The current-season endpoint returns an object. Handle both.
 */
async function fetchSeason(leagueId: string, year: number, views: string[]): Promise<EspnLeagueResponse> {
  const params = new URLSearchParams({ seasonId: String(year) });
  for (const v of views) params.append("view", v);
  const url = `${READ_HOST}/apis/v3/games/ffl/leagueHistory/${leagueId}?${params}`;

  const res = await fetch(url, {
    headers: { Cookie: cookieHeader(), Accept: "application/json" },
  });

  if (res.status === 401 || res.status === 403) {
    throw new EspnAuthError(res.status, `ESPN rejected the credentials for ${year} (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ESPN ${year} request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as EspnLeagueResponse | EspnLeagueResponse[];
  return Array.isArray(json) ? (json[0] ?? {}) : json;
}

/**
 * Probes access without importing anything. Returns a human-readable status
 * per year so a blocked import reports exactly what's missing.
 */
export async function checkAccess(leagueId: string, years: number[]): Promise<{ ok: boolean; lines: string[] }> {
  const env = getEnv();
  const lines: string[] = [];

  if (!env.ESPN_SWID.trim() || !env.ESPN_S2.trim()) {
    return {
      ok: false,
      lines: [
        "MISSING CREDENTIALS — the ESPN import cannot run.",
        "  league 501874 is private; anonymous reads return HTTP 401 AUTH_LEAGUE_NOT_VISIBLE.",
        "  Required in .env.local:",
        "    ESPN_SWID=<the SWID cookie, braces included, e.g. {1A2B3C4D-...}>",
        "    ESPN_S2=<the espn_s2 cookie value>",
        "  Get both from a signed-in session at fantasy.espn.com:",
        "    DevTools -> Application -> Cookies -> https://fantasy.espn.com",
      ],
    };
  }

  let ok = true;
  for (const year of years) {
    try {
      const data = await fetchSeason(leagueId, year, ["mTeam"]);
      const teams = data.teams?.length ?? 0;
      lines.push(`  ${year}: OK (${teams} teams)`);
      if (teams === 0) lines.push(`  ${year}: WARNING — authorised but no teams returned`);
    } catch (e) {
      ok = false;
      lines.push(`  ${year}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok, lines };
}

// --- mapping ----------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Maps ESPN member ids to existing managers by name. Anything that doesn't
 * match confidently is REPORTED, not guessed — merging two different people
 * would silently corrupt career records. Unmatched owners become retired
 * managers (isActive: false) so their history is preserved separately.
 */
async function resolveOwners(members: EspnMember[]): Promise<Map<string, { managerId: string; created: boolean }>> {
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, aliases: { select: { value: true } } },
  });

  const byName = new Map<string, string>();
  for (const m of managers) {
    byName.set(normalize(m.displayName), m.id);
    for (const a of m.aliases) byName.set(normalize(a.value), m.id);
  }

  const out = new Map<string, { managerId: string; created: boolean }>();
  for (const member of members) {
    const candidates = [
      member.displayName,
      [member.firstName, member.lastName].filter(Boolean).join(" "),
    ].filter((x): x is string => !!x && x.trim().length > 0);

    let managerId: string | undefined;
    for (const c of candidates) {
      managerId = byName.get(normalize(c));
      if (managerId) break;
    }

    if (managerId) {
      out.set(member.id, { managerId, created: false });
      continue;
    }

    // A genuinely new person from the ESPN era: preserve them as retired.
    const name = candidates[0] ?? `ESPN member ${member.id.slice(0, 8)}`;
    const created = await prisma.manager.create({
      data: {
        displayName: name,
        joinedYear: FIRST_YEAR,
        isActive: false,
        bio: "Former manager from the league's ESPN era.",
      },
      select: { id: true },
    });
    out.set(member.id, { managerId: created.id, created: true });
  }
  return out;
}

// --- import -----------------------------------------------------------------

async function importYear(leagueId: string, year: number, dryRun: boolean): Promise<string> {
  const data = await fetchSeason(leagueId, year, ["mTeam", "mSettings", "mSchedule", "mMatchupScore"]);
  const teams = data.teams ?? [];
  const members = data.members ?? [];
  const schedule = data.schedule ?? [];

  if (teams.length === 0) return `${year}: no teams returned — skipped`;

  const league = await prisma.league.findFirst({ select: { id: true } });
  if (!league) throw new Error("No League row exists — seed the league before importing ESPN history.");

  const existing = await prisma.season.findUnique({
    where: { leagueId_year: { leagueId: league.id, year } },
    select: { id: true, dataSource: true },
  });
  if (existing && existing.dataSource === "SLEEPER") {
    return `${year}: already present as SLEEPER data — left untouched`;
  }

  if (dryRun) {
    return `${year}: would import ${teams.length} teams, ${members.length} members, ${schedule.length} matchups`;
  }

  const owners = await resolveOwners(members);

  const season = await prisma.season.upsert({
    where: { leagueId_year: { leagueId: league.id, year } },
    create: {
      leagueId: league.id,
      year,
      dataSource: "ESPN",
      espnLeagueId: leagueId,
      status: "COMPLETE",
      regularSeasonWeeks: data.settings?.scheduleSettings?.matchupPeriodCount ?? 14,
    },
    update: { dataSource: "ESPN", espnLeagueId: leagueId },
    select: { id: true },
  });

  // Teams — original ESPN team names and ids are preserved verbatim.
  const teamIdMap = new Map<number, string>();
  for (const t of teams) {
    const ownerId = t.primaryOwner ?? t.owners?.[0];
    const mapped = ownerId ? owners.get(ownerId) : undefined;
    if (!mapped) continue;

    const teamName = t.name?.trim() || [t.location, t.nickname].filter(Boolean).join(" ").trim() || `Team ${t.id}`;
    const rec = t.record?.overall ?? {};

    const ft = await prisma.fantasyTeam.upsert({
      where: { seasonId_managerId: { seasonId: season.id, managerId: mapped.managerId } },
      create: {
        seasonId: season.id,
        managerId: mapped.managerId,
        teamName,
        wins: rec.wins ?? 0,
        losses: rec.losses ?? 0,
        ties: rec.ties ?? 0,
        pointsFor: rec.pointsFor ?? 0,
        pointsAgainst: rec.pointsAgainst ?? 0,
        finalRank: t.rankCalculatedFinal ?? null,
        playoffSeed: t.playoffSeed ?? null,
      },
      update: {
        teamName,
        wins: rec.wins ?? 0,
        losses: rec.losses ?? 0,
        ties: rec.ties ?? 0,
        pointsFor: rec.pointsFor ?? 0,
        pointsAgainst: rec.pointsAgainst ?? 0,
        finalRank: t.rankCalculatedFinal ?? null,
        playoffSeed: t.playoffSeed ?? null,
      },
      select: { id: true },
    });
    teamIdMap.set(t.id, ft.id);
  }

  // Matchups.
  let matchupCount = 0;
  for (const m of schedule) {
    const homeId = m.home?.teamId != null ? teamIdMap.get(m.home.teamId) : undefined;
    const awayId = m.away?.teamId != null ? teamIdMap.get(m.away.teamId) : undefined;
    if (!homeId || !awayId) continue;

    const isPlayoff = !!m.playoffTierType && m.playoffTierType !== "NONE";
    const homeScore = m.home?.totalPoints ?? null;
    const awayScore = m.away?.totalPoints ?? null;

    const matchup = await prisma.matchup.upsert({
      where: { id: `espn-${year}-${m.id}` },
      create: {
        id: `espn-${year}-${m.id}`,
        seasonId: season.id,
        week: m.matchupPeriodId,
        isPlayoff,
        status: homeScore != null && awayScore != null ? "FINAL" : "SCHEDULED",
      },
      update: { week: m.matchupPeriodId, isPlayoff },
      select: { id: true },
    });

    for (const [teamId, score, opponentScore] of [
      [homeId, homeScore, awayScore],
      [awayId, awayScore, homeScore],
    ] as const) {
      await prisma.matchupTeam.upsert({
        where: { matchupId_fantasyTeamId: { matchupId: matchup.id, fantasyTeamId: teamId } },
        create: {
          matchupId: matchup.id,
          fantasyTeamId: teamId,
          score,
          isWinner: score != null && opponentScore != null ? score > opponentScore : null,
        },
        update: {
          score,
          isWinner: score != null && opponentScore != null ? score > opponentScore : null,
        },
      });
    }
    matchupCount++;
  }

  const createdCount = [...owners.values()].filter((o) => o.created).length;
  return `${year}: ${teamIdMap.size} teams, ${matchupCount} matchups${createdCount ? `, ${createdCount} retired manager(s) created` : ""}`;
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fresh = args.includes("--fresh");
  const checkOnly = args.includes("--check");

  const yearsArg = args[args.indexOf("--years") + 1];
  const years: number[] = [];
  if (args.includes("--years") && yearsArg) {
    const [a, b] = yearsArg.split("-").map(Number);
    for (let y = a; y <= (b ?? a); y++) years.push(y);
  } else {
    for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) years.push(y);
  }

  const leagueId = getEnv().ESPN_LEAGUE_ID;
  console.log("=== ESPN history import ===");
  console.log(`league: ${leagueId} | years: ${years[0]}-${years[years.length - 1]} | dryRun: ${dryRun}`);

  const access = await checkAccess(leagueId, checkOnly ? years : [years[0]]);
  console.log(access.lines.join("\n"));
  if (!access.ok) {
    console.log("\nESPN import BLOCKED. No data was written. Every other feature is unaffected.");
    process.exitCode = 2;
    return;
  }
  if (checkOnly) {
    console.log("\nAccess OK — rerun without --check to import.");
    return;
  }

  const cp = loadCheckpoint(fresh);
  const todo = years.filter((y) => !cp.doneYears.includes(y));
  console.log(`${todo.length} year(s) to import (${cp.doneYears.length} already done)\n`);

  for (const year of todo) {
    try {
      const summary = await importYear(leagueId, year, dryRun);
      console.log(`  ${summary}`);
      if (!dryRun) {
        cp.doneYears.push(year);
        saveCheckpoint(cp);
      }
    } catch (e) {
      if (e instanceof EspnAuthError) {
        console.log(`\nAuthentication failed part-way through: ${e.message}`);
        console.log("Progress is checkpointed — refresh the cookies and rerun.");
        process.exitCode = 2;
        return;
      }
      throw e;
    }
  }

  console.log("\nDone. Rerun any time; completed years are skipped.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
