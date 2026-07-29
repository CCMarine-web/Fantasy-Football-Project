import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getTradeTribunal } from "@/server/repositories/trade-tribunal-repository";
import { LOPSIDEDNESS_LABEL } from "@/server/stats/trade-value";
import { findLastPlace } from "@/server/stats/last-place";
import { isAIConfigured } from "@/lib/env";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import {
  generateSeasonArticle,
  type SeasonArticleFacts,
} from "@/server/ai/services/season-article";

/**
 * Turns the commissioner's fragmented season recaps into one polished article
 * per season and PERSISTS it, so the History page renders saved prose instead
 * of stitching text together on every request.
 *
 *   npx tsx scripts/ai/generate-season-articles.ts --dry-run
 *   npx tsx scripts/ai/generate-season-articles.ts
 *   npx tsx scripts/ai/generate-season-articles.ts --years 2023
 *   npx tsx scripts/ai/generate-season-articles.ts --force
 *
 * Articles land in the existing Article table as type SEASON_SUMMARY with a
 * single INTRO section holding the body. Re-running skips seasons that already
 * have an article unless --force is passed.
 */

/**
 * Strips the transcription scaffolding from a commissioner recap: the bare
 * year on its own line and the "RECAP" / "RECAP PART n" separators that mark
 * where one photographed page ended and the next began.
 */
function splitFragments(body: string, year: number): string[] {
  return body
    .split(/\n\s*RECAP(?:\s+PART\s+\d+)?\s*\n?/i)
    .map((part) =>
      part
        .replace(new RegExp(`^\\s*${year}\\s*$`, "gm"), "")
        .replace(/^\s*RECAP(\s+PART\s+\d+)?\s*$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    )
    .filter((part) => part.length > 0);
}

function parseYears(): number[] | null {
  const index = process.argv.indexOf("--years");
  if (index === -1 || !process.argv[index + 1]) return null;
  return process.argv[index + 1]
    .split(",")
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isFinite(y));
}

async function buildFacts(seasonId: string, year: number): Promise<SeasonArticleFacts> {
  const season = await prisma.season.findUniqueOrThrow({
    where: { id: seasonId },
    select: {
      dataSource: true,
      regularSeasonWeeks: true,
      championship: {
        select: {
          championManager: { select: { displayName: true } },
          championFantasyTeam: { select: { teamName: true } },
          runnerUpFantasyTeam: { select: { manager: { select: { displayName: true } } } },
          thirdPlaceFantasyTeam: { select: { manager: { select: { displayName: true } } } },
        },
      },
      fantasyTeams: {
        select: {
          id: true,
          teamName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          finalRank: true,
          regularSeasonRank: true,
          manager: { select: { id: true, displayName: true } },
        },
      },
    },
  });

  const teams = season.fantasyTeams;
  const byFinal = [...teams].sort((a, b) => (a.finalRank ?? 99) - (b.finalRank ?? 99));
  const byPoints = [...teams].sort((a, b) => b.pointsFor - a.pointsFor);
  const regularLeader = [...teams].sort(
    (a, b) => (a.regularSeasonRank ?? 99) - (b.regularSeasonRank ?? 99),
  )[0];
  // Last place from the REGULAR-SEASON standings, using the same shared rule as
  // the Hall of Shame so the recap and the table can never name two people.
  const lastPlace = findLastPlace(
    year,
    teams.map((t) => ({
      managerId: t.manager.id,
      managerName: t.manager.displayName,
      teamName: t.teamName,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      pointsAgainst: 0,
      regularSeasonRank: t.regularSeasonRank,
    })),
  );

  // Weekly extremes and the notable single games. Verified scores only, so an
  // abandoned team's 0.0 is never handed to the writer as the season's lowest
  // score or its biggest blowout.
  const matchupTeams = (
    await prisma.matchupTeam.findMany({
      where: { matchup: { seasonId }, score: { not: null }, verifiedScore: true },
      select: {
        score: true,
        fantasyTeamId: true,
        matchup: {
          select: {
            week: true,
            isPlayoff: true,
            bracketType: true,
            roundName: true,
            teams: { select: { fantasyTeamId: true, score: true, verifiedScore: true } },
          },
        },
      },
    })
  ).filter((mt) => mt.matchup.teams.every((t) => t.verifiedScore));
  const nameOf = new Map(teams.map((t) => [t.id, t.manager.displayName]));

  let bestWeek: string | null = null;
  let closest: string | null = null;
  let blowout: string | null = null;
  let bestWeekScore = -1;
  let closestMargin = Number.POSITIVE_INFINITY;
  let biggestMargin = -1;

  for (const mt of matchupTeams) {
    if (mt.score == null) continue;
    if (mt.score > bestWeekScore) {
      bestWeekScore = mt.score;
      bestWeek = `${nameOf.get(mt.fantasyTeamId) ?? "?"} scored ${mt.score.toFixed(1)} in week ${mt.matchup.week}`;
    }
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== mt.fantasyTeamId);
    if (!opponent || opponent.score == null) continue;
    const margin = mt.score - opponent.score;
    if (margin <= 0) continue;
    if (margin < closestMargin) {
      closestMargin = margin;
      closest = `${nameOf.get(mt.fantasyTeamId) ?? "?"} beat ${nameOf.get(opponent.fantasyTeamId) ?? "?"} by ${margin.toFixed(2)} in week ${mt.matchup.week}`;
    }
    if (margin > biggestMargin) {
      biggestMargin = margin;
      blowout = `${nameOf.get(mt.fantasyTeamId) ?? "?"} beat ${nameOf.get(opponent.fantasyTeamId) ?? "?"} by ${margin.toFixed(1)} in week ${mt.matchup.week}`;
    }
  }

  /*
   * Championship bracket ONLY. Consolation games were being handed to the
   * writer alongside the semifinals, and a run of them read as a playoff run —
   * which is how a manager who missed the postseason ended up described as
   * having gone deep in it. A game with no bracket on record is also left out:
   * an unlabelled game cannot be asserted to be a playoff game.
   */
  const playoffResults: string[] = [];
  const seenPlayoff = new Set<string>();
  for (const mt of matchupTeams) {
    if (!mt.matchup.isPlayoff || mt.matchup.bracketType !== "WINNERS" || mt.score == null) continue;
    const opponent = mt.matchup.teams.find((t) => t.fantasyTeamId !== mt.fantasyTeamId);
    if (!opponent || opponent.score == null) continue;
    if (mt.score < opponent.score) continue;
    const key = `${mt.matchup.week}-${mt.fantasyTeamId}-${opponent.fantasyTeamId}`;
    if (seenPlayoff.has(key)) continue;
    seenPlayoff.add(key);
    playoffResults.push(
      `${mt.matchup.roundName ? `${mt.matchup.roundName}: ` : `Week ${mt.matchup.week}: `}${nameOf.get(mt.fantasyTeamId) ?? "?"} ${mt.score.toFixed(1)} def. ${nameOf.get(opponent.fantasyTeamId) ?? "?"} ${opponent.score.toFixed(1)}`,
    );
  }

  // Meetings between declared (official) rivals in this season.
  const officialRivalries = await prisma.rivalry.findMany({
    where: { isOfficial: true },
    select: {
      managerA: { select: { id: true, displayName: true } },
      managerB: { select: { id: true, displayName: true } },
      meetings: {
        where: { seasonYear: year },
        select: { week: true, managerAScore: true, managerBScore: true, isPlayoff: true },
      },
    },
  });
  const rivalryGames = officialRivalries.flatMap((r) =>
    r.meetings.map((m) => {
      const aWon = m.managerAScore > m.managerBScore;
      const winner = aWon ? r.managerA.displayName : r.managerB.displayName;
      const loser = aWon ? r.managerB.displayName : r.managerA.displayName;
      const hi = Math.max(m.managerAScore, m.managerBScore);
      const lo = Math.min(m.managerAScore, m.managerBScore);
      return `${winner} beat rival ${loser} ${hi.toFixed(1)}-${lo.toFixed(1)} in week ${m.week}${m.isPlayoff ? " (playoffs)" : ""}`;
    }),
  );

  const draft = await prisma.draft.findUnique({
    where: { seasonId },
    select: {
      type: true,
      rounds: true,
      picks: {
        where: { round: 1 },
        orderBy: { pickNumber: "asc" },
        take: 3,
        select: {
          pickNumber: true,
          manager: { select: { displayName: true } },
          player: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  const draftNote = draft
    ? `${draft.rounds}-round ${draft.type.toLowerCase()} draft. First picks: ${draft.picks
        .map(
          (p) =>
            `${p.pickNumber}. ${p.manager?.displayName ?? "?"} took ${p.player ? `${p.player.firstName} ${p.player.lastName}` : "an unrecorded player"}`,
        )
        .join("; ")}`
    : null;

  /*
   * Trades, with the Tribunal's verdict on each. Without these the 2025
   * retrospective was written as though the season had none, while the
   * Tribunal was calling two of them outright fleecings a click away.
   */
  const tribunal = await getTradeTribunal();
  const trades = tribunal
    .filter((t) => t.seasonYear === year)
    .map((t) => {
      const band = t.lopsidedness ? LOPSIDEDNESS_LABEL[t.lopsidedness] : "not graded";
      const sides = t.sides
        .map((s) => `${s.managerName} got ${s.acquired.join(" and ")}`)
        .join("; ");
      return `Week ${t.week ?? "?"}: ${sides}. Tribunal verdict: ${band}. ${t.hindsightSummary}.`;
    });

  const unavailable: string[] = [];
  if (season.dataSource === "ESPN") {
    unavailable.push(
      "ESPN does not retain transactions for archived seasons, so no trades, waiver claims or free-agent moves are on record for this year.",
    );
    unavailable.push("Per-player weekly scoring is not on record for this season.");
  }
  if (!season.championship) unavailable.push("No championship result is recorded for this season.");
  if (!draft) unavailable.push("No draft is on record for this season.");

  return {
    year,
    dataSource: season.dataSource,
    teamCount: teams.length,
    regularSeasonWeeks: season.regularSeasonWeeks,
    champion: season.championship?.championManager.displayName ?? null,
    championTeam: season.championship?.championFantasyTeam.teamName ?? null,
    runnerUp: season.championship?.runnerUpFantasyTeam?.manager.displayName ?? null,
    thirdPlace: season.championship?.thirdPlaceFantasyTeam?.manager.displayName ?? null,
    regularSeasonLeader: regularLeader?.manager.displayName ?? null,
    regularSeasonLeaderRecord: regularLeader
      ? `${regularLeader.wins}-${regularLeader.losses}${regularLeader.ties ? `-${regularLeader.ties}` : ""}`
      : null,
    lastPlace: lastPlace?.managerName ?? null,
    lastPlaceRecord: lastPlace?.record ?? null,
    highestScoringTeam: byPoints[0]?.manager.displayName ?? null,
    highestScoringPoints: byPoints[0] ? Number(byPoints[0].pointsFor.toFixed(1)) : null,
    lowestScoringTeam: byPoints.at(-1)?.manager.displayName ?? null,
    lowestScoringPoints: byPoints.at(-1) ? Number(byPoints.at(-1)!.pointsFor.toFixed(1)) : null,
    standings: byFinal.map((t, i) => ({
      rank: t.finalRank ?? i + 1,
      manager: t.manager.displayName,
      teamName: t.teamName,
      record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
      pointsFor: Number(t.pointsFor.toFixed(1)),
    })),
    playoffResults,
    bestWeek,
    closestGame: closest,
    biggestBlowout: blowout,
    rivalryGames,
    draftNote,
    trades,
    commissionerFragments: [],
    unavailable,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const onlyYears = parseYears();

  console.log(`=== season history articles ===${dryRun ? " (DRY RUN)" : ""}`);
  if (!isAIConfigured() && !dryRun) {
    console.log("No OPENAI_API_KEY — refusing to write placeholder articles. Nothing changed.");
    process.exitCode = 2;
    return;
  }

  const seasons = await prisma.season.findMany({
    where: { fantasyTeams: { some: {} }, ...(onlyYears ? { year: { in: onlyYears } } : {}) },
    select: { id: true, year: true },
    orderBy: { year: "asc" },
  });

  const safeguards = await getContentSafeguards();
  let written = 0;
  let skipped = 0;

  for (const season of seasons) {
    const existing = await prisma.article.findFirst({
      where: { seasonId: season.id, type: "SEASON_SUMMARY", deletedAt: null },
      select: { id: true, title: true },
    });
    if (existing && !force) {
      console.log(
        `  ${season.year}: already written ("${existing.title}") — use --force to rewrite`,
      );
      skipped++;
      continue;
    }

    const narrative = await prisma.leagueHistorySection.findMany({
      where: { year: season.year, approvalStatus: "APPROVED", sectionType: { not: "OTHER" } },
      orderBy: { sortOrder: "asc" },
      select: { body: true },
    });

    const facts = await buildFacts(season.id, season.year);
    facts.commissionerFragments = narrative.flatMap((n) => splitFragments(n.body, season.year));

    // A season nobody has played has no story yet, however many roster rows
    // exist for it.
    const gamesPlayed = facts.standings.some((s) => s.record !== "0-0");
    if (!gamesPlayed) {
      console.log(`  ${season.year}: not played yet — skipped`);
      skipped++;
      continue;
    }
    if (facts.commissionerFragments.length === 0 && facts.standings.length === 0) {
      console.log(`  ${season.year}: nothing to write from`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(
        `  ${season.year}: would write from ${facts.commissionerFragments.length} fragment(s), ${facts.standings.length} standings row(s), ${facts.playoffResults.length} playoff result(s), ${facts.rivalryGames.length} rivalry game(s)`,
      );
      continue;
    }

    const article = await generateSeasonArticle(facts, safeguards);
    if (article.isMock) {
      console.log(`  ${season.year}: mock provider returned placeholder text — not saved`);
      skipped++;
      continue;
    }

    const slug = `season-${season.year}`;
    const saved = await prisma.article.upsert({
      where: { seasonId_slug: { seasonId: season.id, slug } },
      create: {
        seasonId: season.id,
        type: "SEASON_SUMMARY",
        title: article.title,
        slug,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
      update: {
        title: article.title,
        status: "PUBLISHED",
        publishedAt: new Date(),
        deletedAt: null,
      },
      select: { id: true },
    });

    // One INTRO section holds the body; replaced wholesale on a rewrite.
    await prisma.articleSection.deleteMany({ where: { articleId: saved.id } });
    await prisma.articleSection.create({
      data: {
        articleId: saved.id,
        sectionType: "INTRO",
        heading: null,
        body: article.body,
        order: 0,
      },
    });

    const words = article.body.split(/\s+/).length;
    console.log(
      `  ${season.year}: "${article.title}" (${words} words, ${article.body.split(/\n\s*\n/).length} paragraphs)`,
    );
    written++;
  }

  console.log(
    `\n${dryRun ? "DRY RUN — nothing saved." : `Wrote ${written} article(s), skipped ${skipped}.`}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
