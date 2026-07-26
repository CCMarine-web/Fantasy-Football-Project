import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import {
  EspnAuthError,
  EspnSeasonUnavailableError,
  fetchSeason,
  hasCredentials,
  redactSecrets,
  type EspnSeasonData,
} from "./espn/client";
import { collectAccounts, recordEspnAliases, resolveOwners } from "./espn/owners";
import { importSeason, type SeasonImportResult } from "./espn/import-season";

/**
 * Imports the league's ESPN history into the same tables the Sleeper sync
 * writes, marked `dataSource: ESPN` so the two eras stay distinguishable and
 * Sleeper data is never overwritten.
 *
 *   npx tsx scripts/import/import-espn-history.ts --check      # access probe only
 *   npx tsx scripts/import/import-espn-history.ts --dry-run    # resolve + report, no writes
 *   npx tsx scripts/import/import-espn-history.ts
 *   npx tsx scripts/import/import-espn-history.ts --years 2019-2022
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 * League 501874 is private, so two cookies from a signed-in ESPN session are
 * required in .env.local: ESPN_SWID (braces included) and ESPN_S2. Neither is
 * ever printed: every response body and error message passes through
 * `redactSecrets()` first, because an ESPN member id is a SWID and therefore
 * appears inside ordinary responses.
 *
 * ── Resilience ────────────────────────────────────────────────────────────
 * Seasons are independent. One failing year is recorded and the rest continue;
 * the run ends with an explicit list of what succeeded and what did not. Only
 * an authentication failure stops the run early, because every remaining
 * request would fail the same way.
 */

const REQUESTED_FIRST_YEAR = 2016;
const REQUESTED_LAST_YEAR = 2022;

const VIEWS = ["mTeam", "mSettings", "mMatchupScore", "mRoster", "mDraftDetail", "mTransactions2"];

interface FailedSeason {
  year: number;
  reason: string;
  unavailable: boolean;
}

function parseYears(args: string[]): number[] {
  const index = args.indexOf("--years");
  const years: number[] = [];
  if (index !== -1 && args[index + 1]) {
    const [from, to] = args[index + 1].split("-").map(Number);
    if (Number.isFinite(from)) {
      for (let year = from; year <= (Number.isFinite(to) ? to : from); year++) years.push(year);
    }
  }
  if (years.length === 0) {
    for (let year = REQUESTED_FIRST_YEAR; year <= REQUESTED_LAST_YEAR; year++) years.push(year);
  }
  return years;
}

/**
 * Picks the League row the ESPN seasons attach to.
 *
 * `findFirst()` without an ordering is NOT safe here: Postgres may return a
 * different row on each call, and a duplicate League row (see
 * scripts/import/dedupe-leagues.ts) once caused two consecutive runs of this
 * importer to write every ESPN season twice, under a different root each time.
 * The league holding the SLEEPER seasons is the source of truth; anything else
 * is a stray that must be cleaned up before importing rather than written to.
 */
async function resolveLeague(): Promise<{ id: string; foundedYear: number }> {
  const leagues = await prisma.league.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      foundedYear: true,
      _count: { select: { seasons: true } },
      seasons: { where: { dataSource: "SLEEPER" }, select: { id: true }, take: 1 },
    },
  });
  if (leagues.length === 0) {
    throw new Error("No League row exists — seed the league before importing ESPN history.");
  }
  if (leagues.length > 1) {
    const withSleeper = leagues.filter((l) => l.seasons.length > 0);
    if (withSleeper.length !== 1) {
      throw new Error(
        `${leagues.length} League rows exist and ${withSleeper.length} hold Sleeper seasons, so the ESPN seasons cannot be attached unambiguously. ` +
          `Run: npx tsx scripts/import/dedupe-leagues.ts`,
      );
    }
    console.log(
      `\nWARNING: ${leagues.length} League rows exist. Attaching to ${withSleeper[0].id}, the one holding the Sleeper seasons.`,
    );
    console.log("  Clean up the stray row with: npx tsx scripts/import/dedupe-leagues.ts");
    return withSleeper[0];
  }
  return leagues[0];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const checkOnly = args.includes("--check");
  const years = parseYears(args);
  const leagueId = getEnv().ESPN_LEAGUE_ID;

  console.log("=== ESPN history import ===");
  console.log(`league ${leagueId} | seasons ${years[0]}-${years[years.length - 1]}${dryRun ? " | DRY RUN (no writes)" : ""}`);

  if (!hasCredentials()) {
    console.log("\nBLOCKED: ESPN credentials are not configured.");
    console.log("  League 501874 is private; anonymous reads return HTTP 401 AUTH_LEAGUE_NOT_VISIBLE.");
    console.log("  Add ESPN_SWID and ESPN_S2 to .env.local (DevTools -> Application -> Cookies");
    console.log("  -> https://fantasy.espn.com while signed in). Nothing was written.");
    process.exitCode = 2;
    return;
  }

  // ── Fetch every season first ───────────────────────────────────────────
  // Owner identity has to be resolved across the whole history before anything
  // is written (see owners.ts), so all seasons are fetched up front.
  const fetched: { year: number; data: EspnSeasonData }[] = [];
  const failed: FailedSeason[] = [];

  for (const year of years) {
    try {
      const data = await fetchSeason(leagueId, year, VIEWS);
      const teams = data.teams?.length ?? 0;
      if (teams === 0) {
        failed.push({ year, reason: "ESPN returned no teams for this season", unavailable: true });
        console.log(`  ${year}: no teams returned`);
        continue;
      }
      fetched.push({ year, data });
      console.log(
        `  ${year}: fetched ${teams} teams, ${data.members?.length ?? 0} members, ${data.schedule?.length ?? 0} scheduled games, ${data.draftDetail?.picks?.length ?? 0} draft picks`,
      );
    } catch (error) {
      if (error instanceof EspnAuthError) {
        console.log(`\nBLOCKED: ${redactSecrets(error.message)}`);
        console.log("  The cookies are present but no longer valid. Refresh both values in .env.local and rerun.");
        console.log("  Nothing was written.");
        process.exitCode = 2;
        return;
      }
      if (error instanceof EspnSeasonUnavailableError) {
        failed.push({ year, reason: error.message, unavailable: true });
        console.log(`  ${year}: unavailable (HTTP 404)`);
        continue;
      }
      const reason = redactSecrets(error instanceof Error ? error.message : String(error));
      failed.push({ year, reason, unavailable: false });
      console.log(`  ${year}: FAILED — ${reason}`);
    }
  }

  // Report what ESPN itself claims about the league's span, so a missing year
  // is visibly missing rather than silently absent.
  const claimedSeasons = fetched.at(-1)?.data.status?.previousSeasons ?? [];
  if (claimedSeasons.length > 0) {
    const missing = claimedSeasons.filter((y) => y >= years[0] && y <= years[years.length - 1] && !fetched.some((f) => f.year === y));
    if (missing.length > 0) {
      console.log(`\nESPN lists ${claimedSeasons.join(", ")} as prior seasons but serves no data for: ${missing.join(", ")}`);
    }
  }

  if (fetched.length === 0) {
    console.log("\nNo seasons could be fetched. Nothing was written.");
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    console.log(`\nAccess OK for ${fetched.map((f) => f.year).join(", ")}. Rerun without --check to import.`);
    return;
  }

  // ── Resolve owners across the whole history ────────────────────────────
  const accounts = collectAccounts(fetched);
  const owners = await resolveOwners(accounts, dryRun);

  console.log(`\n--- owner mapping (${accounts.length} ESPN accounts) ---`);
  for (const account of accounts) {
    const resolution = owners.byMemberId.get(account.espnMemberId);
    const seasons = account.seasons.length ? account.seasons.sort((a, b) => a - b).join(",") : "no team";
    const names = account.names.length ? account.names.join(" / ") : "(no usable name)";
    console.log(
      `  ${names.padEnd(44)} -> ${(resolution?.managerName ?? "UNRESOLVED").padEnd(22)} [${resolution?.via ?? "?"}${resolution?.createdRetiredManager ? ", RETIRED MANAGER CREATED" : ""}] seasons ${seasons}`,
    );
  }

  const created = accounts.filter((a) => owners.byMemberId.get(a.espnMemberId)?.createdRetiredManager);
  console.log(
    created.length === 0
      ? "  every ESPN account matched an existing manager — no retired managers needed"
      : `  ${created.length} ESPN-era account(s) had no match and were preserved as retired managers`,
  );

  if (dryRun) {
    console.log("\nDRY RUN — no data was written. Season-by-season plan:");
    for (const { year, data } of fetched) {
      const existing = await prisma.season.findFirst({ where: { year }, select: { dataSource: true } });
      const note = existing?.dataSource === "SLEEPER" ? "would SKIP (SLEEPER data present)" : "would import";
      console.log(
        `  ${year}: ${note} — ${data.teams?.length ?? 0} teams, ${(data.schedule ?? []).filter((m) => m.home?.teamId != null && m.away?.teamId != null).length} games, ${data.draftDetail?.picks?.length ?? 0} picks`,
      );
    }
    return;
  }

  const aliasCount = await recordEspnAliases(owners);
  if (aliasCount > 0) console.log(`  recorded ${aliasCount} ESPN name alias(es) on existing managers`);

  // ── Import season by season ────────────────────────────────────────────
  const league = await resolveLeague();

  const results: SeasonImportResult[] = [];
  console.log("\n--- importing ---");

  for (const { year, data } of fetched) {
    const log = await prisma.dataSyncLog.create({
      data: { syncType: "SEASON", status: "RUNNING" },
      select: { id: true },
    });
    try {
      const result = await importSeason(leagueId, league.id, year, data, owners);
      results.push(result);
      if (result.skipped) {
        console.log(`  ${year}: skipped — ${result.skipped}`);
      } else {
        console.log(
          `  ${year}: ${result.teams} teams, ${result.matchups} games (${result.playoffMatchups} playoff), ` +
            `${result.standingSnapshots} standings rows, ${result.draftPicks} picks, ` +
            `${result.rosters} rosters/${result.rosterPlayers} players` +
            (result.champion ? `, champion: ${result.champion}` : ", champion: not determined"),
        );
      }
      for (const warning of result.warnings) console.log(`      warning: ${warning}`);
      await prisma.dataSyncLog.update({
        where: { id: log.id },
        data: {
          status: result.warnings.length > 0 ? "PARTIAL" : "SUCCESS",
          recordsProcessed: result.teams + result.matchups + result.draftPicks + result.rosterPlayers,
          errorMessage: result.warnings.length > 0 ? redactSecrets(result.warnings.join(" | ")).slice(0, 1000) : null,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      const reason = redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error));
      failed.push({ year, reason: reason.split("\n")[0], unavailable: false });
      console.log(`  ${year}: FAILED — ${reason.split("\n")[0]}`);
      await prisma.dataSyncLog.update({
        where: { id: log.id },
        data: { status: "FAILED", errorMessage: reason.slice(0, 1000), finishedAt: new Date() },
      });
      // Keep going: the remaining seasons are independent.
    }
  }

  // ── Post-import corrections that depend on the imported seasons ─────────
  const imported = results.filter((r) => !r.skipped);
  if (imported.length > 0) {
    const earliestYear = Math.min(...imported.map((r) => r.year));

    // `joinedYear` was seeded from the Sleeper era only, so every veteran read
    // as a 2026 rookie. Reset each manager to their real first season.
    const managers = await prisma.manager.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true, joinedYear: true, fantasyTeams: { select: { season: { select: { year: true } } } } },
    });
    let joinedFixed = 0;
    for (const manager of managers) {
      const yearsPlayed = manager.fantasyTeams.map((t) => t.season.year);
      if (yearsPlayed.length === 0) continue;
      const first = Math.min(...yearsPlayed);
      if (first !== manager.joinedYear) {
        await prisma.manager.update({ where: { id: manager.id }, data: { joinedYear: first } });
        joinedFixed++;
      }
    }
    if (joinedFixed > 0) console.log(`\ncorrected joinedYear for ${joinedFixed} manager(s)`);

    if (league.foundedYear > earliestYear) {
      await prisma.league.update({ where: { id: league.id }, data: { foundedYear: earliestYear } });
      console.log(`league foundedYear ${league.foundedYear} -> ${earliestYear} (earliest season with verified data)`);
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────
  console.log("\n=== summary ===");
  const succeeded = imported.map((r) => r.year);
  const skipped = results.filter((r) => r.skipped);
  console.log(`imported: ${succeeded.length ? succeeded.join(", ") : "none"}`);
  if (skipped.length > 0) console.log(`skipped:  ${skipped.map((r) => `${r.year} (${r.skipped})`).join("; ")}`);

  if (failed.length > 0) {
    console.log(`\nfailed seasons (${failed.length}):`);
    for (const failure of failed) {
      console.log(`  ${failure.year}: ${failure.unavailable ? "NO DATA AVAILABLE FROM ESPN" : "ERROR"} — ${failure.reason}`);
    }
  } else {
    console.log("failed:   none");
  }

  for (const result of imported) {
    console.log(
      `  ${result.year}: champion=${result.champion ?? "?"} runnerUp=${result.runnerUp ?? "?"} third=${result.thirdPlace ?? "?"}`,
    );
  }

  console.log("\nTransactions, waivers and trades: ESPN retains none for completed seasons.");
  console.log("Verified across every documented route; nothing was invented to fill the gap.");
  console.log("\nNext: npx tsx scripts/import/recalculate-derived-stats.ts");
}

main()
  .catch((error) => {
    console.error(redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
