import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "@/lib/db";
import { readXlsx } from "./lib/xlsx";

/**
 * Imports the commissioner's official rivalries from the Rivalries workbook and
 * recomputes head-to-head statistics for EVERY pair of managers that has ever
 * met. The workbook is the source of truth for *which* pairings are official;
 * every number is derived from verified matchup results (Sleeper today, ESPN
 * seasons automatically included once imported).
 *
 *   npx tsx scripts/import/import-rivalries.ts --dry-run
 *   npx tsx scripts/import/import-rivalries.ts
 *   npx tsx scripts/import/import-rivalries.ts --file "C:\\path\\Rivalries.xlsx"
 *
 * Nothing here is AI-generated. Rivalry commentary is written separately by
 * scripts/ai/backfill-blurbs.ts from these verified numbers.
 */

const DEFAULT_WORKBOOK = "C:\\Users\\antho\\Downloads\\Rivalries.xlsx";

// --- name resolution --------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** Levenshtein distance — used only to tolerate spelling drift in the sheet. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

interface Candidate {
  managerId: string;
  displayName: string;
  /** Every name we know this manager by. */
  names: string[];
}

/**
 * Resolves a name from the sheet to exactly one manager. Exact (normalized)
 * matches win outright. Otherwise we require a unique close match on BOTH the
 * first name and the surname — spelling drift like "Markemeir" for
 * "Barkemeyer" should resolve, but anything genuinely ambiguous throws rather
 * than risk merging two different people.
 */
function resolveManager(raw: string, candidates: Candidate[]): { managerId: string; how: string } {
  const target = normalize(raw);

  const exact = candidates.filter((c) => c.names.some((n) => normalize(n) === target));
  if (exact.length === 1) return { managerId: exact[0].managerId, how: "exact" };
  if (exact.length > 1) {
    throw new Error(`"${raw}" matches ${exact.length} managers exactly: ${exact.map((c) => c.displayName).join(", ")}`);
  }

  const [rawFirst = "", ...rawRest] = raw.trim().split(/\s+/);
  const rawLast = rawRest.length ? rawRest[rawRest.length - 1] : "";
  if (!rawLast) throw new Error(`"${raw}" has no surname to disambiguate on`);

  const scored: { c: Candidate; dist: number; via: string }[] = [];
  for (const c of candidates) {
    for (const n of c.names) {
      const [nFirst = "", ...nRest] = n.trim().split(/\s+/);
      const nLast = nRest.length ? nRest[nRest.length - 1] : "";
      if (!nLast) continue;
      const firstDist = editDistance(normalize(rawFirst), normalize(nFirst));
      const lastDist = editDistance(normalize(rawLast), normalize(nLast));
      // First names must essentially match; surnames may drift a little.
      if (firstDist <= 1 && lastDist <= 3) scored.push({ c, dist: firstDist + lastDist, via: n });
    }
  }
  if (scored.length === 0) throw new Error(`No manager matches "${raw}"`);

  scored.sort((x, y) => x.dist - y.dist);
  const best = scored[0];
  const bestIds = new Set(scored.filter((s) => s.dist === best.dist).map((s) => s.c.managerId));
  if (bestIds.size > 1) {
    throw new Error(
      `"${raw}" is ambiguous between: ${[...bestIds]
        .map((id) => candidates.find((c) => c.managerId === id)?.displayName)
        .join(", ")} — refusing to guess`,
    );
  }
  return { managerId: best.c.managerId, how: `fuzzy(distance ${best.dist} via "${best.via}")` };
}

// --- head-to-head computation ----------------------------------------------

interface Meeting {
  seasonYear: number;
  week: number;
  isPlayoff: boolean;
  isChampionship: boolean;
  dataSource: "SLEEPER" | "ESPN" | "MANUAL";
  /** managerId -> score */
  scores: Record<string, number>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

async function collectMeetings(): Promise<Map<string, Meeting[]>> {
  const rows = await prisma.matchupTeam.findMany({
    where: { score: { not: null } },
    select: {
      score: true,
      fantasyTeam: { select: { managerId: true } },
      matchup: {
        select: {
          id: true,
          week: true,
          isPlayoff: true,
          season: { select: { year: true, dataSource: true } },
          teams: { select: { score: true, fantasyTeam: { select: { managerId: true } } } },
        },
      },
    },
  });

  // Champion per season, plus the final playoff week per season — together
  // these identify a title game without inventing bracket data we don't have.
  const champs = await prisma.championship.findMany({
    select: { championManagerId: true, season: { select: { year: true } } },
  });
  const championByYear = new Map(champs.map((c) => [c.season.year, c.championManagerId]));

  const finalPlayoffWeek = new Map<number, number>();
  for (const r of rows) {
    if (!r.matchup.isPlayoff) continue;
    const y = r.matchup.season.year;
    finalPlayoffWeek.set(y, Math.max(finalPlayoffWeek.get(y) ?? 0, r.matchup.week));
  }

  const seen = new Set<string>();
  const byPair = new Map<string, Meeting[]>();

  for (const r of rows) {
    const m = r.matchup;
    if (m.teams.length !== 2) continue;
    if (seen.has(m.id)) continue;
    seen.add(m.id);

    const [t1, t2] = m.teams;
    const a = t1.fantasyTeam.managerId;
    const b = t2.fantasyTeam.managerId;
    if (!a || !b || a === b) continue;
    if (t1.score == null || t2.score == null) continue;

    const year = m.season.year;
    const champion = championByYear.get(year);
    const isTitleGame =
      m.isPlayoff &&
      m.week === finalPlayoffWeek.get(year) &&
      champion != null &&
      (champion === a || champion === b);

    const key = pairKey(a, b);
    const list = byPair.get(key) ?? [];
    list.push({
      seasonYear: year,
      week: m.week,
      isPlayoff: m.isPlayoff,
      isChampionship: isTitleGame,
      dataSource: m.season.dataSource as Meeting["dataSource"],
      scores: { [a]: t1.score, [b]: t2.score },
    });
    byPair.set(key, list);
  }

  for (const list of byPair.values()) {
    list.sort((x, y) => x.seasonYear - y.seasonYear || x.week - y.week);
  }
  return byPair;
}

interface Computed {
  managerAId: string;
  managerBId: string;
  gamesPlayed: number;
  managerAWins: number;
  managerBWins: number;
  ties: number;
  managerAPoints: number;
  managerBPoints: number;
  averageMargin: number | null;
  playoffMeetings: number;
  championshipMeetings: number;
  closestGameMargin: number | null;
  closestGameSeason: number | null;
  largestBlowoutMargin: number | null;
  largestBlowoutManagerId: string | null;
  largestBlowoutSeason: number | null;
  currentStreakManagerId: string | null;
  currentStreakCount: number;
  longestStreakManagerId: string | null;
  longestStreakCount: number;
  lastMeetingWinnerId: string | null;
  lastMeetingSeason: number | null;
  lastMeetingWeek: number | null;
  rivalryScore: number;
  meetings: Meeting[];
}

function computePair(aId: string, bId: string, meetings: Meeting[]): Computed {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;
  let aPoints = 0;
  let bPoints = 0;
  let marginSum = 0;
  let playoffMeetings = 0;
  let championshipMeetings = 0;

  let closest: { margin: number; season: number } | null = null;
  let blowout: { margin: number; season: number; winnerId: string } | null = null;

  let curStreakId: string | null = null;
  let curStreak = 0;
  let longestId: string | null = null;
  let longest = 0;

  let lastWinnerId: string | null = null;
  let lastSeason: number | null = null;
  let lastWeek: number | null = null;

  for (const m of meetings) {
    const aScore = m.scores[aId];
    const bScore = m.scores[bId];
    aPoints += aScore;
    bPoints += bScore;
    const margin = Math.abs(aScore - bScore);
    marginSum += margin;
    if (m.isPlayoff) playoffMeetings++;
    if (m.isChampionship) championshipMeetings++;

    const winnerId = aScore > bScore ? aId : bScore > aScore ? bId : null;
    if (winnerId === aId) aWins++;
    else if (winnerId === bId) bWins++;
    else ties++;

    // Ties end a streak without starting a new one.
    if (winnerId === null) {
      curStreakId = null;
      curStreak = 0;
    } else if (winnerId === curStreakId) {
      curStreak++;
    } else {
      curStreakId = winnerId;
      curStreak = 1;
    }
    if (curStreakId && curStreak > longest) {
      longest = curStreak;
      longestId = curStreakId;
    }

    if (winnerId !== null) {
      if (!closest || margin < closest.margin) closest = { margin, season: m.seasonYear };
      if (!blowout || margin > blowout.margin) blowout = { margin, season: m.seasonYear, winnerId };
    }

    lastWinnerId = winnerId;
    lastSeason = m.seasonYear;
    lastWeek = m.week;
  }

  const games = meetings.length;
  const avgMargin = games ? marginSum / games : null;
  // Closeness and postseason stakes make a rivalry; volume alone doesn't.
  const rivalryScore =
    games * 3 + playoffMeetings * 6 + championshipMeetings * 10 + Math.max(0, 25 - (avgMargin ?? 25));

  return {
    managerAId: aId,
    managerBId: bId,
    gamesPlayed: games,
    managerAWins: aWins,
    managerBWins: bWins,
    ties,
    managerAPoints: Number(aPoints.toFixed(2)),
    managerBPoints: Number(bPoints.toFixed(2)),
    averageMargin: avgMargin == null ? null : Number(avgMargin.toFixed(2)),
    playoffMeetings,
    championshipMeetings,
    closestGameMargin: closest ? Number(closest.margin.toFixed(2)) : null,
    closestGameSeason: closest?.season ?? null,
    largestBlowoutMargin: blowout ? Number(blowout.margin.toFixed(2)) : null,
    largestBlowoutManagerId: blowout?.winnerId ?? null,
    largestBlowoutSeason: blowout?.season ?? null,
    currentStreakManagerId: curStreak > 0 ? curStreakId : null,
    currentStreakCount: curStreak,
    longestStreakManagerId: longestId,
    longestStreakCount: longest,
    lastMeetingWinnerId: lastWinnerId,
    lastMeetingSeason: lastSeason,
    lastMeetingWeek: lastWeek,
    rivalryScore: Number(rivalryScore.toFixed(2)),
    meetings,
  };
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.indexOf("--file");
  const workbookPath = fileArg >= 0 && args[fileArg + 1] ? args[fileArg + 1] : DEFAULT_WORKBOOK;

  // 1. Official pairings from the workbook.
  const officialPairs: { aRaw: string; bRaw: string }[] = [];
  if (existsSync(workbookPath)) {
    const sheets = readXlsx(workbookPath, readFileSync);
    const sheet = sheets.find((s) => /rival/i.test(s.name)) ?? sheets[0];
    console.log(`Workbook: ${workbookPath}  (sheet "${sheet.name}", ${sheet.rows.length} rows)`);
    for (const row of sheet.rows) {
      const cells = Object.entries(row)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([, v]) => v.trim())
        .filter(Boolean);
      if (cells.length < 2) continue;
      // Skip the header row.
      if (/^rival/i.test(cells[0]) && /^rival/i.test(cells[1])) continue;
      officialPairs.push({ aRaw: cells[0], bRaw: cells[1] });
    }
  } else {
    console.log(`Workbook not found at ${workbookPath} — recomputing stats only, official flags untouched.`);
  }
  console.log(`Official rivalries in workbook: ${officialPairs.length}`);

  // 2. Candidate names for resolution.
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, aliases: { select: { value: true, aliasType: true } } },
  });
  const candidates: Candidate[] = managers.map((m) => ({
    managerId: m.id,
    displayName: m.displayName,
    names: [
      m.displayName,
      ...m.aliases.filter((a) => a.aliasType === "FULL_NAME" || a.aliasType === "FIRST_NAME").map((a) => a.value),
    ],
  }));

  const officialKeys = new Set<string>();
  for (const p of officialPairs) {
    const a = resolveManager(p.aRaw, candidates);
    const b = resolveManager(p.bRaw, candidates);
    if (a.managerId === b.managerId) throw new Error(`"${p.aRaw}" and "${p.bRaw}" resolved to the same manager`);
    const nameOf = (id: string) => candidates.find((c) => c.managerId === id)!.displayName;
    console.log(`  ${p.aRaw} [${a.how}] -> ${nameOf(a.managerId)}   vs   ${p.bRaw} [${b.how}] -> ${nameOf(b.managerId)}`);
    officialKeys.add(pairKey(a.managerId, b.managerId));
  }

  // 3. Head-to-head stats for every pair that has actually met.
  const byPair = await collectMeetings();
  console.log(`\nPairs with at least one meeting: ${byPair.size}`);

  const missingOfficial = [...officialKeys].filter((k) => !byPair.has(k));
  if (missingOfficial.length) {
    console.log(`Official pairs with no recorded meetings yet: ${missingOfficial.length} (they'll be stored 0-0)`);
  }

  if (dryRun) {
    for (const key of officialKeys) {
      const [a, b] = key.split("|");
      const c = computePair(a, b, byPair.get(key) ?? []);
      const nameOf = (id: string) => candidates.find((x) => x.managerId === id)?.displayName ?? id;
      console.log(
        `  OFFICIAL ${nameOf(a)} vs ${nameOf(b)}: ${c.gamesPlayed} games, ${c.managerAWins}-${c.managerBWins}-${c.ties}, avgMargin=${c.averageMargin}, playoffs=${c.playoffMeetings}`,
      );
    }
    console.log("\n--dry-run: no changes written.");
    return;
  }

  // 4. Persist. Every pair gets stats; only workbook pairs are flagged official.
  const allKeys = new Set<string>([...byPair.keys(), ...officialKeys]);
  let written = 0;
  for (const key of allKeys) {
    const [aId, bId] = key.split("|");
    const c = computePair(aId, bId, byPair.get(key) ?? []);
    const isOfficial = officialKeys.has(key);

    const data = {
      gamesPlayed: c.gamesPlayed,
      managerAWins: c.managerAWins,
      managerBWins: c.managerBWins,
      ties: c.ties,
      managerAPoints: c.managerAPoints,
      managerBPoints: c.managerBPoints,
      averageMargin: c.averageMargin,
      playoffMeetings: c.playoffMeetings,
      championshipMeetings: c.championshipMeetings,
      closestGameMargin: c.closestGameMargin,
      closestGameSeason: c.closestGameSeason,
      largestBlowoutMargin: c.largestBlowoutMargin,
      largestBlowoutManagerId: c.largestBlowoutManagerId,
      largestBlowoutSeason: c.largestBlowoutSeason,
      currentStreakManagerId: c.currentStreakManagerId,
      currentStreakCount: c.currentStreakCount,
      longestStreakManagerId: c.longestStreakManagerId,
      longestStreakCount: c.longestStreakCount,
      lastMeetingWinnerId: c.lastMeetingWinnerId,
      lastMeetingSeason: c.lastMeetingSeason,
      lastMeetingWeek: c.lastMeetingWeek,
      rivalryScore: c.rivalryScore,
      isOfficial,
      ...(isOfficial ? { source: "Rivalries.xlsx" } : {}),
    };

    const rivalry = await prisma.rivalry.upsert({
      where: { managerAId_managerBId: { managerAId: aId, managerBId: bId } },
      create: { managerAId: aId, managerBId: bId, ...data },
      update: data,
    });

    // Replace the meeting log wholesale — it's derived data.
    await prisma.rivalryMeeting.deleteMany({ where: { rivalryId: rivalry.id } });
    if (c.meetings.length) {
      await prisma.rivalryMeeting.createMany({
        data: c.meetings.map((m) => ({
          rivalryId: rivalry.id,
          seasonYear: m.seasonYear,
          week: m.week,
          managerAScore: m.scores[aId],
          managerBScore: m.scores[bId],
          winnerId: m.scores[aId] > m.scores[bId] ? aId : m.scores[bId] > m.scores[aId] ? bId : null,
          isPlayoff: m.isPlayoff,
          isChampionship: m.isChampionship,
          dataSource: m.dataSource,
        })),
      });
    }
    written++;
  }

  console.log(`\nWrote ${written} rivalry row(s); ${officialKeys.size} flagged official.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
