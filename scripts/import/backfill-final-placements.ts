import "../lib/load-env";
import { prisma } from "@/lib/db";
import { deriveFinalPlacements } from "@/server/sleeper/final-placements";
import type { SleeperBracketMatchup } from "@/server/sleeper/types";

/**
 * Backfills `finalRank` for every completed Sleeper season from the playoff
 * brackets, so each manager's season row shows a real finishing position
 * instead of a dash.
 *
 *   npx tsx scripts/import/backfill-final-placements.ts --dry-run
 *   npx tsx scripts/import/backfill-final-placements.ts
 *
 * The sync now does this going forward (see coreSyncPlayoffResults); this
 * script exists to repair the seasons that were synced before it did.
 *
 * ESPN seasons are untouched — their `rankCalculatedFinal` already gives a
 * complete 1..N order and is the authority for those years.
 */

const API = "https://api.sleeper.app/v1";

async function bracket(
  leagueId: string,
  kind: "winners_bracket" | "losers_bracket",
): Promise<SleeperBracketMatchup[]> {
  const res = await fetch(`${API}/league/${leagueId}/${kind}`);
  if (!res.ok) throw new Error(`Sleeper ${kind} for league ${leagueId}: HTTP ${res.status}`);
  return (await res.json()) as SleeperBracketMatchup[];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const seasons = await prisma.season.findMany({
    where: { dataSource: "SLEEPER", sleeperLeagueId: { not: null } },
    select: { id: true, year: true, sleeperLeagueId: true, playoffTeams: true, status: true },
    orderBy: { year: "asc" },
  });

  console.log(`=== final-placement backfill ===${dryRun ? " (DRY RUN)" : ""}`);
  let updated = 0;

  for (const season of seasons) {
    const leagueId = season.sleeperLeagueId!;
    let winners: SleeperBracketMatchup[];
    let losers: SleeperBracketMatchup[];
    try {
      [winners, losers] = await Promise.all([
        bracket(leagueId, "winners_bracket"),
        bracket(leagueId, "losers_bracket"),
      ]);
    } catch (error) {
      console.log(
        `  ${season.year}: FAILED — ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    const placements = deriveFinalPlacements(winners, losers, season.playoffTeams);
    if (placements.problem) {
      console.log(`  ${season.year}: SKIPPED — ${placements.problem}`);
      continue;
    }
    if (placements.byRosterId.size === 0) {
      console.log(`  ${season.year}: no decided placements yet (${season.status.toLowerCase()})`);
      continue;
    }

    const teams = await prisma.fantasyTeam.findMany({
      where: { seasonId: season.id },
      select: {
        id: true,
        sleeperRosterId: true,
        finalRank: true,
        madePlayoffs: true,
        manager: { select: { displayName: true } },
      },
    });
    const byRoster = new Map(
      teams.filter((t) => t.sleeperRosterId).map((t) => [Number(t.sleeperRosterId), t]),
    );

    const lines: string[] = [];
    for (const [rosterId, place] of [...placements.byRosterId].sort((a, b) => a[1] - b[1])) {
      const team = byRoster.get(rosterId);
      if (!team) {
        lines.push(`      roster ${rosterId} -> #${place} (no FantasyTeam row)`);
        continue;
      }
      const madePlayoffs = placements.playoffRosterIds.has(rosterId);
      const changed = team.finalRank !== place || team.madePlayoffs !== madePlayoffs;
      lines.push(
        `      #${String(place).padStart(2)} ${team.manager.displayName.padEnd(20)} ${changed ? `was ${team.finalRank ?? "—"}` : "unchanged"}`,
      );
      if (!dryRun && changed) {
        await prisma.fantasyTeam.update({
          where: { id: team.id },
          data: { finalRank: place, madePlayoffs },
        });
        updated++;
      }
    }
    console.log(`  ${season.year}: ${placements.byRosterId.size} placement(s)`);
    for (const line of lines) console.log(line);
  }

  console.log(dryRun ? "\nDRY RUN — nothing written." : `\nUpdated ${updated} team row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
