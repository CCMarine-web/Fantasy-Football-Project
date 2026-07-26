import "../lib/load-env";
import { prisma } from "@/lib/db";

/** Read-only snapshot of what's currently in the database. Diagnostics only. */
async function main() {
  const leagues = await prisma.league.findMany({
    include: { _count: { select: { seasons: true } } },
  });
  console.log(`league rows: ${leagues.length}`);
  for (const l of leagues) {
    console.log(
      `  ${l.id} "${l.name}" founded=${l.foundedYear} sleeperId=${l.sleeperLeagueId ?? "none"} seasons=${l._count.seasons}`,
    );
  }

  const seasons = await prisma.season.findMany({
    orderBy: { year: "asc" },
    include: {
      _count: {
        select: {
          fantasyTeams: true,
          matchups: true,
          drafts: true,
          transactions: true,
          standingSnapshots: true,
        },
      },
    },
  });
  console.log("\nseasons:");
  for (const s of seasons) {
    console.log(
      `  ${s.year} ${s.dataSource.padEnd(7)} status=${s.status} teams=${s._count.fantasyTeams} matchups=${s._count.matchups} drafts=${s._count.drafts} tx=${s._count.transactions} snaps=${s._count.standingSnapshots}`,
    );
  }

  const managers = await prisma.manager.findMany({
    orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    include: { aliases: true, _count: { select: { fantasyTeams: true, championships: true } } },
  });
  console.log(`\nmanagers (${managers.length}):`);
  for (const m of managers) {
    console.log(
      `  ${m.isActive ? "active " : "retired"} ${m.displayName.padEnd(24)} joined=${m.joinedYear} sleeper=${m.sleeperUserId ? "yes" : "no"} teams=${m._count.fantasyTeams} rings=${m._count.championships} aliases=[${m.aliases.map((a) => a.value).join(", ")}]`,
    );
  }

  const counts = {
    championships: await prisma.championship.count(),
    records: await prisma.leagueRecord.count(),
    rivalries: await prisma.rivalry.count(),
    rivalryMeetings: await prisma.rivalryMeeting.count(),
    draftGrades: await prisma.draftGrade.count(),
    players: await prisma.fantasyPlayer.count(),
    rosters: await prisma.roster.count(),
    weeklyPlayerScores: await prisma.weeklyPlayerScore.count(),
    draftPicks: await prisma.draftPick.count(),
    historySections: await prisma.leagueHistorySection.count(),
    articles: await prisma.article.count(),
  };
  console.log("\ncounts:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
