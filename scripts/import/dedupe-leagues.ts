import "../lib/load-env";
import { prisma } from "@/lib/db";

/**
 * Collapses the database back to a single League row.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * Sleeper issues a NEW league id every season, and `syncCurrentLeague` used to
 * upsert `League` keyed on that id — so syncing a new season created a second
 * League row instead of reusing the existing one. Every read in the app is
 * `league.findFirst()`, which assumes a singleton, so the stray row was
 * invisible until the ESPN importer resolved `findFirst()` to a different row
 * on two consecutive runs and wrote each ESPN season under both leagues.
 *
 * `syncCurrentLeague` has since been fixed to reuse the existing League row
 * (see src/server/sleeper/sync-service.ts). This script cleans up the rows the
 * old behaviour left behind.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 * The canonical league is the one holding SLEEPER seasons — that data is the
 * source of truth and is never touched. Any other League row and the seasons
 * hanging off it are deleted, along with everything that referenced them.
 * Deletion order follows the foreign keys. A SLEEPER season is never deleted,
 * whichever league it sits under: if one is found under a non-canonical
 * league the script refuses to run rather than risk real data.
 *
 *   npx tsx scripts/import/dedupe-leagues.ts --dry-run
 *   npx tsx scripts/import/dedupe-leagues.ts
 */

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const leagues = await prisma.league.findMany({
    include: {
      seasons: { select: { id: true, year: true, dataSource: true }, orderBy: { year: "asc" } },
    },
  });

  console.log(`=== league de-duplication ===${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`${leagues.length} League row(s) found:`);
  for (const league of leagues) {
    const sleeper = league.seasons.filter((s) => s.dataSource === "SLEEPER").map((s) => s.year);
    const espn = league.seasons.filter((s) => s.dataSource === "ESPN").map((s) => s.year);
    console.log(
      `  ${league.id} "${league.name}" founded=${league.foundedYear} sleeperLeagueId=${league.sleeperLeagueId ?? "none"}`,
    );
    console.log(`    SLEEPER seasons: ${sleeper.join(", ") || "none"}`);
    console.log(`    ESPN seasons:    ${espn.join(", ") || "none"}`);
  }

  if (leagues.length <= 1) {
    console.log("\nNothing to do — the database already holds a single league.");
    return;
  }

  const withSleeper = leagues.filter((l) => l.seasons.some((s) => s.dataSource === "SLEEPER"));
  if (withSleeper.length !== 1) {
    console.log(
      `\nREFUSING TO RUN: ${withSleeper.length} league(s) hold SLEEPER seasons. ` +
        `The canonical league cannot be determined automatically without risking real data.`,
    );
    process.exitCode = 1;
    return;
  }

  const canonical = withSleeper[0];
  const doomed = leagues.filter((l) => l.id !== canonical.id);
  console.log(`\nkeeping   ${canonical.id} (holds the SLEEPER seasons)`);
  console.log(`deleting  ${doomed.map((l) => l.id).join(", ")}`);

  for (const league of doomed) {
    const sleeperSeasons = league.seasons.filter((s) => s.dataSource === "SLEEPER");
    if (sleeperSeasons.length > 0) {
      console.log(
        `\nREFUSING TO RUN: league ${league.id} holds SLEEPER season(s) ${sleeperSeasons.map((s) => s.year).join(", ")}.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  if (dryRun) {
    const seasonIds = doomed.flatMap((l) => l.seasons.map((s) => s.id));
    const teams = await prisma.fantasyTeam.count({ where: { seasonId: { in: seasonIds } } });
    const matchups = await prisma.matchup.count({ where: { seasonId: { in: seasonIds } } });
    const picks = await prisma.draftPick.count({
      where: { draft: { seasonId: { in: seasonIds } } },
    });
    console.log(
      `\nDRY RUN — would delete ${seasonIds.length} season(s), ${teams} team(s), ${matchups} matchup(s), ${picks} draft pick(s).`,
    );
    return;
  }

  for (const league of doomed) {
    const seasonIds = league.seasons.map((s) => s.id);
    if (seasonIds.length > 0) {
      const teams = await prisma.fantasyTeam.findMany({
        where: { seasonId: { in: seasonIds } },
        select: { id: true },
      });
      const teamIds = teams.map((t) => t.id);
      const rosters = await prisma.roster.findMany({
        where: { fantasyTeamId: { in: teamIds } },
        select: { id: true },
      });
      const rosterIds = rosters.map((r) => r.id);
      const matchups = await prisma.matchup.findMany({
        where: { seasonId: { in: seasonIds } },
        select: { id: true },
      });
      const matchupIds = matchups.map((m) => m.id);
      const transactions = await prisma.transaction.findMany({
        where: { seasonId: { in: seasonIds } },
        select: { id: true },
      });
      const transactionIds = transactions.map((t) => t.id);
      const drafts = await prisma.draft.findMany({
        where: { seasonId: { in: seasonIds } },
        select: { id: true },
      });
      const draftIds = drafts.map((d) => d.id);

      // Leaves first, roots last.
      const steps: [string, () => Promise<{ count: number }>][] = [
        [
          "weeklyPlayerScore",
          () => prisma.weeklyPlayerScore.deleteMany({ where: { rosterId: { in: rosterIds } } }),
        ],
        ["roster", () => prisma.roster.deleteMany({ where: { id: { in: rosterIds } } })],
        [
          "playoffBracket",
          () => prisma.playoffBracket.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "matchupTeam",
          () => prisma.matchupTeam.deleteMany({ where: { matchupId: { in: matchupIds } } }),
        ],
        ["matchup", () => prisma.matchup.deleteMany({ where: { id: { in: matchupIds } } })],
        [
          "standingSnapshot",
          () => prisma.standingSnapshot.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "championship",
          () => prisma.championship.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "trade",
          () => prisma.trade.deleteMany({ where: { transactionId: { in: transactionIds } } }),
        ],
        [
          "transactionAsset",
          () =>
            prisma.transactionAsset.deleteMany({
              where: { transactionId: { in: transactionIds } },
            }),
        ],
        [
          "transaction",
          () => prisma.transaction.deleteMany({ where: { id: { in: transactionIds } } }),
        ],
        ["draftPick", () => prisma.draftPick.deleteMany({ where: { draftId: { in: draftIds } } })],
        ["draft", () => prisma.draft.deleteMany({ where: { id: { in: draftIds } } })],
        ["award", () => prisma.award.deleteMany({ where: { seasonId: { in: seasonIds } } })],
        [
          "weeklyAward",
          () => prisma.weeklyAward.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "draftGrade",
          () => prisma.draftGrade.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "prediction",
          () => prisma.prediction.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        ["receipt", () => prisma.receipt.deleteMany({ where: { seasonId: { in: seasonIds } } })],
        [
          "leagueRecord",
          () => prisma.leagueRecord.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "historicalQuote",
          () => prisma.historicalQuote.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "articleSection",
          () =>
            prisma.articleSection.deleteMany({
              where: { article: { seasonId: { in: seasonIds } } },
            }),
        ],
        ["article", () => prisma.article.deleteMany({ where: { seasonId: { in: seasonIds } } })],
        [
          "punishment",
          () => prisma.punishment.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        [
          "dataSyncLog",
          () => prisma.dataSyncLog.deleteMany({ where: { seasonId: { in: seasonIds } } }),
        ],
        // TeamNameHistory may point at a doomed team; the name itself is also
        // recorded against the surviving team, so these rows are redundant.
        [
          "teamNameHistory",
          () => prisma.teamNameHistory.deleteMany({ where: { fantasyTeamId: { in: teamIds } } }),
        ],
        [
          "leagueHistorySection (season link)",
          () =>
            prisma.leagueHistorySection.updateMany({
              where: { seasonId: { in: seasonIds } },
              data: { seasonId: null },
            }),
        ],
        ["fantasyTeam", () => prisma.fantasyTeam.deleteMany({ where: { id: { in: teamIds } } })],
        ["season", () => prisma.season.deleteMany({ where: { id: { in: seasonIds } } })],
      ];

      for (const [label, run] of steps) {
        const { count } = await run();
        if (count > 0) console.log(`  ${league.id}: deleted ${count} ${label}`);
      }
    }

    await prisma.league.delete({ where: { id: league.id } });
    console.log(`  deleted League ${league.id}`);
  }

  const remaining = await prisma.league.count();
  console.log(`\nDone. ${remaining} League row remains.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
