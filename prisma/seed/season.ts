import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { BracketType, DraftType, MatchupStatus, SeasonStatus } from "@/generated/prisma/client";
import {
  MANAGERS,
  PLAYOFF_START_WEEK,
  REGULAR_SEASON_WEEKS,
  TEAM_COUNT,
  teamNameForSeason,
} from "./constants";
import { buildDraftPlan } from "./draft";
import type { Rng } from "./rng";
import { weeklyPairings } from "./schedule";
import { buildWeeklyLineup, simulateGameScores } from "./sim-helpers";
import { applyResult, createAccumulators, rankAccumulators, streakLabel } from "./standings";
import type { FinalStandingRow, ManagerKey, Position } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

export interface SeasonSimInput {
  prisma: PrismaClient;
  rng: Rng;
  leagueId: string;
  year: number;
  status: SeasonStatus;
  isCurrent: boolean;
  /** How many regular-season weeks to actually simulate (14 for completed seasons). */
  weeksToPlay: number;
  simulatePlayoffs: boolean;
  managerIdByKey: Record<ManagerKey, string>;
  playerIdsByPosition: Record<Position, string[]>;
  /** Round-1 snake draft order, as team indices (see MANAGERS order). */
  draftOrderTeamIndices: number[];
  /** These two are guaranteed to make the playoffs and to meet in (and decide) the championship. */
  prescribedChampionKey?: ManagerKey;
  prescribedRunnerUpKey?: ManagerKey;
}

export interface SeasonSimOutput {
  seasonId: string;
  year: number;
  fantasyTeamIdByManagerKey: Record<ManagerKey, string>;
  draftId: string;
  draftedPlayerIdsByManagerKey: Record<ManagerKey, string[]>;
  finalStandings: FinalStandingRow[];
  championKey?: ManagerKey;
  runnerUpKey?: ManagerKey;
  thirdKey?: ManagerKey;
}

const MANAGER_KEYS: ManagerKey[] = MANAGERS.map((m) => m.key);

export async function simulateSeason(input: SeasonSimInput): Promise<SeasonSimOutput> {
  const {
    prisma,
    rng,
    leagueId,
    year,
    status,
    isCurrent,
    weeksToPlay,
    simulatePlayoffs,
    managerIdByKey,
    playerIdsByPosition,
    draftOrderTeamIndices,
    prescribedChampionKey,
    prescribedRunnerUpKey,
  } = input;

  const season = await prisma.season.create({
    data: {
      leagueId,
      year,
      status,
      isCurrent,
      regularSeasonWeeks: REGULAR_SEASON_WEEKS,
      playoffTeams: 6,
      playoffStartWeek: PLAYOFF_START_WEEK,
    },
  });

  // --- FantasyTeams ----------------------------------------------------
  const fantasyTeamIdByManagerKey = {} as Record<ManagerKey, string>;
  const teamRows: Prisma.FantasyTeamCreateManyInput[] = MANAGERS.map((m) => {
    const id = newId();
    fantasyTeamIdByManagerKey[m.key] = id;
    return {
      id,
      seasonId: season.id,
      managerId: managerIdByKey[m.key]!,
      teamName: teamNameForSeason(m.key, year),
    };
  });
  await prisma.fantasyTeam.createMany({ data: teamRows });

  // --- Draft -------------------------------------------------------------
  const draftId = newId();
  await prisma.draft.create({
    data: {
      id: draftId,
      seasonId: season.id,
      type: DraftType.SNAKE,
      rounds: 16,
      startedAt: new Date(Date.UTC(year, 7, 24, 18, 0, 0)),
      completedAt: new Date(Date.UTC(year, 7, 24, 21, 45, 0)),
    },
  });

  const draftPlan = buildDraftPlan(rng, draftOrderTeamIndices, playerIdsByPosition);
  const draftedPlayerIdsByTeamIndex: string[][] = Array.from({ length: TEAM_COUNT }, () => []);
  const draftPickRows: Prisma.DraftPickCreateManyInput[] = draftPlan.map((p) => {
    const managerKey = MANAGER_KEYS[p.teamIndex]!;
    const teamId = fantasyTeamIdByManagerKey[managerKey]!;
    draftedPlayerIdsByTeamIndex[p.teamIndex]![p.round - 1] = p.playerId;
    return {
      id: newId(),
      draftId,
      round: p.round,
      pickNumber: p.pickNumber,
      draftSlot: p.draftSlot,
      originalFantasyTeamId: teamId,
      fantasyTeamId: teamId,
      managerId: managerIdByKey[managerKey]!,
      playerId: p.playerId,
      isKeeper: p.isKeeper,
    };
  });
  await prisma.draftPick.createMany({ data: draftPickRows });

  const draftedPlayerIdsByManagerKey = {} as Record<ManagerKey, string[]>;
  MANAGER_KEYS.forEach((key, idx) => {
    draftedPlayerIdsByManagerKey[key] = draftedPlayerIdsByTeamIndex[idx]!;
  });

  // --- Per-season team strength (fixed for the season; weekly noise is
  // added on top of this by simulateGameScores) ---------------------------
  const seasonStrength: number[] = MANAGERS.map((m) => rng.round(m.baseStrength + rng.gaussian(0, 3), 2));

  // --- Regular season ------------------------------------------------------
  const accumulators = createAccumulators(MANAGER_KEYS, fantasyTeamIdByManagerKey);
  const pairingsByWeek = weeklyPairings(weeksToPlay);

  const matchupRows: Prisma.MatchupCreateManyInput[] = [];
  const matchupTeamRows: Prisma.MatchupTeamCreateManyInput[] = [];
  const rosterRows: Prisma.RosterCreateManyInput[] = [];
  const weeklyScoreRows: Prisma.WeeklyPlayerScoreCreateManyInput[] = [];
  const standingSnapshotRows: Prisma.StandingSnapshotCreateManyInput[] = [];
  const playoffBracketRows: Prisma.PlayoffBracketCreateManyInput[] = [];

  function addTeamWeek(
    teamIndex: number,
    week: number,
    score: number,
  ): { benchPoints: number; projectedScore: number } {
    const teamId = fantasyTeamIdByManagerKey[MANAGER_KEYS[teamIndex]!]!;
    const lineup = buildWeeklyLineup(rng, score);
    const rosterId = newId();
    rosterRows.push({ id: rosterId, fantasyTeamId: teamId, week });
    const draftedIds = draftedPlayerIdsByTeamIndex[teamIndex]!;

    for (const s of lineup.starters) {
      weeklyScoreRows.push({
        id: newId(),
        rosterId,
        playerId: draftedIds[s.round - 1]!,
        lineupSlot: s.lineupSlot,
        isStarter: true,
        points: s.points,
        projectedPoints: s.projectedPoints,
      });
    }
    for (const b of lineup.bench) {
      weeklyScoreRows.push({
        id: newId(),
        rosterId,
        playerId: draftedIds[b.round - 1]!,
        lineupSlot: "BN",
        isStarter: false,
        points: b.points,
        projectedPoints: b.projectedPoints,
      });
    }

    const projectedScore = rng.round(lineup.starters.reduce((a, s) => a + s.projectedPoints, 0));
    return { benchPoints: lineup.benchPoints, projectedScore };
  }

  for (let week = 1; week <= weeksToPlay; week++) {
    const pairs = pairingsByWeek[week - 1]!;
    for (const [aIdx, bIdx] of pairs) {
      const { scoreA, scoreB, winner } = simulateGameScores(
        rng,
        seasonStrength[aIdx]!,
        seasonStrength[bIdx]!,
      );
      const matchupId = newId();
      matchupRows.push({
        id: matchupId,
        seasonId: season.id,
        week,
        isPlayoff: false,
        status: MatchupStatus.FINAL,
      });

      const aInfo = addTeamWeek(aIdx, week, scoreA);
      const bInfo = addTeamWeek(bIdx, week, scoreB);

      matchupTeamRows.push({
        id: newId(),
        matchupId,
        fantasyTeamId: fantasyTeamIdByManagerKey[MANAGER_KEYS[aIdx]!]!,
        score: scoreA,
        projectedScore: aInfo.projectedScore,
        benchPoints: aInfo.benchPoints,
        isWinner: winner === "TIE" ? null : winner === "A",
      });
      matchupTeamRows.push({
        id: newId(),
        matchupId,
        fantasyTeamId: fantasyTeamIdByManagerKey[MANAGER_KEYS[bIdx]!]!,
        score: scoreB,
        projectedScore: bInfo.projectedScore,
        benchPoints: bInfo.benchPoints,
        isWinner: winner === "TIE" ? null : winner === "B",
      });

      applyResult(accumulators[aIdx]!, scoreA, scoreB, winner === "A" ? "W" : winner === "B" ? "L" : "T");
      applyResult(accumulators[bIdx]!, scoreB, scoreA, winner === "B" ? "W" : winner === "A" ? "L" : "T");
    }

    const ranked = rankAccumulators(accumulators);
    ranked.forEach((acc, i) => {
      standingSnapshotRows.push({
        id: newId(),
        seasonId: season.id,
        fantasyTeamId: acc.fantasyTeamId,
        week,
        wins: acc.wins,
        losses: acc.losses,
        ties: acc.ties,
        pointsFor: rng.round(acc.pointsFor),
        pointsAgainst: rng.round(acc.pointsAgainst),
        rank: i + 1,
        streak: streakLabel(acc),
      });
    });
  }

  const rankedFinal = rankAccumulators(accumulators);
  const finalStandings: FinalStandingRow[] = rankedFinal.map((acc, i) => ({
    fantasyTeamId: acc.fantasyTeamId,
    managerKey: acc.managerKey,
    teamIndex: acc.teamIndex,
    wins: acc.wins,
    losses: acc.losses,
    ties: acc.ties,
    pointsFor: rng.round(acc.pointsFor),
    pointsAgainst: rng.round(acc.pointsAgainst),
    regularSeasonRank: i + 1,
  }));

  // --- Playoffs ------------------------------------------------------------
  const finalRankByManagerKey = {} as Record<ManagerKey, number>;
  const playoffSeedByManagerKey = {} as Record<ManagerKey, number | null>;
  const madePlayoffsByManagerKey = {} as Record<ManagerKey, boolean>;
  MANAGER_KEYS.forEach((k) => {
    madePlayoffsByManagerKey[k] = false;
    playoffSeedByManagerKey[k] = null;
  });
  finalStandings.forEach((row) => {
    finalRankByManagerKey[row.managerKey] = row.regularSeasonRank;
  });

  let championKey: ManagerKey | undefined;
  let runnerUpKey: ManagerKey | undefined;
  let thirdKey: ManagerKey | undefined;

  if (simulatePlayoffs) {
    let qualified = finalStandings.slice(0, 6).map((r) => r.managerKey);

    for (const forcedKey of [prescribedChampionKey, prescribedRunnerUpKey]) {
      if (forcedKey && !qualified.includes(forcedKey)) {
        qualified = qualified.slice(0, 5);
        qualified.push(forcedKey);
      }
    }
    qualified.sort((a, b) => finalRankByManagerKey[a]! - finalRankByManagerKey[b]!);

    const rest = qualified
      .filter((k) => k !== prescribedChampionKey && k !== prescribedRunnerUpKey)
      .sort((a, b) => finalRankByManagerKey[a]! - finalRankByManagerKey[b]!);

    const seeds: ManagerKey[] = [];
    if (prescribedChampionKey) seeds.push(prescribedChampionKey);
    if (prescribedRunnerUpKey) seeds.push(prescribedRunnerUpKey);
    for (const k of rest) {
      if (seeds.length >= 6) break;
      seeds.push(k);
    }
    while (seeds.length < 6) {
      const filler = qualified.find((k) => !seeds.includes(k));
      if (!filler) break;
      seeds.push(filler);
    }

    seeds.forEach((k, i) => {
      playoffSeedByManagerKey[k] = i + 1;
      madePlayoffsByManagerKey[k] = true;
    });

    const teamIdOf = (k: ManagerKey) => fantasyTeamIdByManagerKey[k]!;
    const idxOf = (k: ManagerKey) => MANAGER_KEYS.indexOf(k);

    function playGame(
      week: number,
      roundName: string,
      playoffRound: number,
      aKey: ManagerKey,
      bKey: ManagerKey,
      forceWinner?: "A" | "B",
    ): { winner: ManagerKey; loser: ManagerKey } {
      const { scoreA, scoreB, winner } = simulateGameScores(
        rng,
        seasonStrength[idxOf(aKey)]!,
        seasonStrength[idxOf(bKey)]!,
        forceWinner ? { forceWinner } : undefined,
      );
      const matchupId = newId();
      matchupRows.push({
        id: matchupId,
        seasonId: season.id,
        week,
        isPlayoff: true,
        playoffRound,
        bracketType: BracketType.WINNERS,
        roundName,
        status: MatchupStatus.FINAL,
      });
      playoffBracketRows.push({
        id: newId(),
        seasonId: season.id,
        round: playoffRound,
        bracketType: BracketType.WINNERS,
        roundName,
        matchupId,
      });
      const aInfo = addTeamWeek(idxOf(aKey), week, scoreA);
      const bInfo = addTeamWeek(idxOf(bKey), week, scoreB);
      matchupTeamRows.push({
        id: newId(),
        matchupId,
        fantasyTeamId: teamIdOf(aKey),
        score: scoreA,
        projectedScore: aInfo.projectedScore,
        benchPoints: aInfo.benchPoints,
        isWinner: winner === "A",
      });
      matchupTeamRows.push({
        id: newId(),
        matchupId,
        fantasyTeamId: teamIdOf(bKey),
        score: scoreB,
        projectedScore: bInfo.projectedScore,
        benchPoints: bInfo.benchPoints,
        isWinner: winner === "B",
      });
      return winner === "A" ? { winner: aKey, loser: bKey } : { winner: bKey, loser: aKey };
    }

    const qfWeek = PLAYOFF_START_WEEK;
    const sfWeek = PLAYOFF_START_WEEK + 1;
    const champWeek = PLAYOFF_START_WEEK + 2;

    const qf1 = playGame(qfWeek, "Quarterfinal", 1, seeds[2]!, seeds[5]!);
    const qf2 = playGame(qfWeek, "Quarterfinal", 1, seeds[3]!, seeds[4]!);

    const sf1 = playGame(
      sfWeek,
      "Semifinal",
      2,
      seeds[0]!,
      qf2.winner,
      prescribedChampionKey ? "A" : undefined,
    );
    const sf2 = playGame(
      sfWeek,
      "Semifinal",
      2,
      seeds[1]!,
      qf1.winner,
      prescribedRunnerUpKey ? "A" : undefined,
    );

    const champGame = playGame(
      champWeek,
      "Championship",
      3,
      sf1.winner,
      sf2.winner,
      prescribedChampionKey ? "A" : undefined,
    );

    championKey = champGame.winner;
    runnerUpKey = champGame.loser;

    const sfLosers = [sf1.loser, sf2.loser].sort(
      (a, b) => playoffSeedByManagerKey[a]! - playoffSeedByManagerKey[b]!,
    );
    thirdKey = sfLosers[0];
    const fourthKey = sfLosers[1];
    const qfLosers = [qf1.loser, qf2.loser].sort(
      (a, b) => playoffSeedByManagerKey[a]! - playoffSeedByManagerKey[b]!,
    );
    const fifthKey = qfLosers[0];
    const sixthKey = qfLosers[1];

    finalRankByManagerKey[championKey] = 1;
    finalRankByManagerKey[runnerUpKey] = 2;
    if (thirdKey) finalRankByManagerKey[thirdKey] = 3;
    if (fourthKey) finalRankByManagerKey[fourthKey] = 4;
    if (fifthKey) finalRankByManagerKey[fifthKey] = 5;
    if (sixthKey) finalRankByManagerKey[sixthKey] = 6;
  }

  // --- Persist bulk rows -----------------------------------------------
  await prisma.$transaction([
    prisma.matchup.createMany({ data: matchupRows }),
    prisma.matchupTeam.createMany({ data: matchupTeamRows }),
    prisma.roster.createMany({ data: rosterRows }),
    prisma.playoffBracket.createMany({ data: playoffBracketRows }),
  ]);
  await prisma.weeklyPlayerScore.createMany({ data: weeklyScoreRows });
  await prisma.standingSnapshot.createMany({ data: standingSnapshotRows });

  await prisma.$transaction(
    finalStandings.map((row) =>
      prisma.fantasyTeam.update({
        where: { id: row.fantasyTeamId },
        data: {
          wins: row.wins,
          losses: row.losses,
          ties: row.ties,
          pointsFor: row.pointsFor,
          pointsAgainst: row.pointsAgainst,
          regularSeasonRank: row.regularSeasonRank,
          finalRank: finalRankByManagerKey[row.managerKey] ?? row.regularSeasonRank,
          madePlayoffs: madePlayoffsByManagerKey[row.managerKey] ?? false,
          playoffSeed: playoffSeedByManagerKey[row.managerKey] ?? null,
          isChampion: row.managerKey === championKey,
        },
      }),
    ),
  );

  return {
    seasonId: season.id,
    year,
    fantasyTeamIdByManagerKey,
    draftId,
    draftedPlayerIdsByManagerKey,
    finalStandings,
    championKey,
    runnerUpKey,
    thirdKey,
  };
}
