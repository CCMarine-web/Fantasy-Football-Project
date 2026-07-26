import { prisma } from "@/lib/db";
import {
  fetchPlayers,
  type EspnMatchup,
  type EspnPlayer,
  type EspnSeasonData,
  type EspnTeam,
} from "./client";
import { teamOwner, type OwnerMap } from "./owners";
import {
  bracketFromTier,
  draftTypeFromEspn,
  isStartingSlot,
  positionFromEspn,
  proTeamFromEspn,
  slotFromEspn,
} from "./reference";

/**
 * Writes one ESPN season into the same tables the Sleeper sync uses, tagged
 * `dataSource: ESPN`.
 *
 * Rules this file exists to enforce:
 *  - A season already marked SLEEPER is never touched.
 *  - Every write is an upsert on a stable ESPN key, so reruns update in place.
 *  - Fields ESPN does not return are left null. Nothing is inferred to fill a
 *    column (see the roster and transaction notes below).
 */

export interface SeasonImportResult {
  year: number;
  skipped?: string;
  teams: number;
  matchups: number;
  playoffMatchups: number;
  standingSnapshots: number;
  draftPicks: number;
  rosters: number;
  rosterPlayers: number;
  players: number;
  transactions: number;
  champion?: string;
  runnerUp?: string;
  thirdPlace?: string;
  warnings: string[];
}

function teamDisplayName(team: EspnTeam): string {
  const explicit = team.name?.trim();
  if (explicit) return explicit;
  const composed = [team.location, team.nickname]
    .filter((p) => p && p.trim())
    .join(" ")
    .trim();
  return composed || `Team ${team.id}`;
}

/** A matchup with only one side is an ESPN bye placeholder, not a game. */
function isRealGame(matchup: EspnMatchup): boolean {
  return matchup.home?.teamId != null && matchup.away?.teamId != null;
}

/**
 * Names a playoff round from its distance to the final. Round 1 is the final,
 * so the label is derived from how many rounds follow it.
 */
function roundName(tier: string, roundsFromEnd: number, isFinalRound: boolean): string {
  const consolation = tier !== "WINNERS_BRACKET";
  if (consolation) {
    return tier === "WINNERS_CONSOLATION_LADDER" ? "Third-place bracket" : "Consolation bracket";
  }
  if (isFinalRound) return "Championship";
  if (roundsFromEnd === 1) return "Semifinal";
  if (roundsFromEnd === 2) return "Quarterfinal";
  return `Playoff round ${roundsFromEnd + 1} from the final`;
}

export async function importSeason(
  leagueId: string,
  leagueRowId: string,
  year: number,
  data: EspnSeasonData,
  owners: OwnerMap,
): Promise<SeasonImportResult> {
  const result: SeasonImportResult = {
    year,
    teams: 0,
    matchups: 0,
    playoffMatchups: 0,
    standingSnapshots: 0,
    draftPicks: 0,
    rosters: 0,
    rosterPlayers: 0,
    players: 0,
    transactions: 0,
    warnings: [],
  };

  const espnTeams = data.teams ?? [];
  if (espnTeams.length === 0) {
    result.skipped = "ESPN returned no teams for this season";
    return result;
  }

  const existing = await prisma.season.findUnique({
    where: { leagueId_year: { leagueId: leagueRowId, year } },
    select: { id: true, dataSource: true },
  });
  if (existing && existing.dataSource === "SLEEPER") {
    result.skipped = "season already present as SLEEPER data — left untouched";
    return result;
  }

  const regularSeasonWeeks = data.settings?.scheduleSettings?.matchupPeriodCount ?? 14;
  const playoffTeams = data.settings?.scheduleSettings?.playoffTeamCount ?? 0;

  const season = await prisma.season.upsert({
    where: { leagueId_year: { leagueId: leagueRowId, year } },
    create: {
      leagueId: leagueRowId,
      year,
      dataSource: "ESPN",
      espnLeagueId: leagueId,
      status: "COMPLETE",
      regularSeasonWeeks,
      playoffTeams,
      playoffStartWeek: regularSeasonWeeks + 1,
      isCurrent: false,
    },
    update: {
      dataSource: "ESPN",
      espnLeagueId: leagueId,
      status: "COMPLETE",
      regularSeasonWeeks,
      playoffTeams,
      playoffStartWeek: regularSeasonWeeks + 1,
    },
    select: { id: true },
  });

  // ── Teams ────────────────────────────────────────────────────────────────
  const schedule = (data.schedule ?? []).filter(isRealGame);
  const playoffGames = schedule.filter((m) => m.playoffTierType && m.playoffTierType !== "NONE");
  const championshipRound = playoffGames.length
    ? Math.max(...playoffGames.map((m) => m.matchupPeriodId))
    : 0;
  const finalGame = playoffGames.find(
    (m) => m.matchupPeriodId === championshipRound && m.playoffTierType === "WINNERS_BRACKET",
  );

  /** ESPN team id -> the winners-bracket champion / runner-up, from the final. */
  let championEspnTeamId: number | undefined;
  let runnerUpEspnTeamId: number | undefined;
  if (finalGame && finalGame.winner === "HOME") {
    championEspnTeamId = finalGame.home?.teamId;
    runnerUpEspnTeamId = finalGame.away?.teamId;
  } else if (finalGame && finalGame.winner === "AWAY") {
    championEspnTeamId = finalGame.away?.teamId;
    runnerUpEspnTeamId = finalGame.home?.teamId;
  }

  // Cross-check against ESPN's own final ranking. They have always agreed for
  // this league; a disagreement is reported rather than silently resolved.
  const rankOne = espnTeams.find((t) => t.rankCalculatedFinal === 1);
  if (championEspnTeamId != null && rankOne && rankOne.id !== championEspnTeamId) {
    result.warnings.push(
      `champion ambiguous: winners-bracket final was won by team ${championEspnTeamId} but ESPN's final ranking puts team ${rankOne.id} first — no Championship row written`,
    );
    championEspnTeamId = undefined;
    runnerUpEspnTeamId = undefined;
  }
  if (championEspnTeamId == null && !finalGame) {
    result.warnings.push(
      "no winners-bracket final found in the schedule — no Championship row written",
    );
  }

  const thirdPlaceEspnTeamId = espnTeams.find((t) => t.rankCalculatedFinal === 3)?.id;

  const teamRowByEspnId = new Map<number, { id: string; managerId: string; teamName: string }>();
  const claimedManagers = new Set<string>();

  for (const espnTeam of [...espnTeams].sort((a, b) => a.id - b.id)) {
    const owner = teamOwner(espnTeam, owners, claimedManagers);
    if (!owner) {
      result.warnings.push(
        `team ${espnTeam.id} "${teamDisplayName(espnTeam)}" has no resolvable owner — skipped`,
      );
      continue;
    }
    if (claimedManagers.has(owner.managerId)) {
      result.warnings.push(
        `team ${espnTeam.id} "${teamDisplayName(espnTeam)}" resolves to ${owner.managerName}, who already owns another team this season — skipped to avoid merging two teams into one career`,
      );
      continue;
    }
    claimedManagers.add(owner.managerId);

    const record = espnTeam.record?.overall ?? {};
    const teamName = teamDisplayName(espnTeam);
    const madePlayoffs =
      playoffGames.some(
        (m) =>
          m.playoffTierType === "WINNERS_BRACKET" &&
          (m.home?.teamId === espnTeam.id || m.away?.teamId === espnTeam.id),
      ) ||
      (playoffTeams > 0 && (espnTeam.playoffSeed ?? 99) <= playoffTeams);

    const fields = {
      teamName,
      logoUrl: espnTeam.logo?.trim() || null,
      wins: record.wins ?? 0,
      losses: record.losses ?? 0,
      ties: record.ties ?? 0,
      pointsFor: record.pointsFor ?? 0,
      pointsAgainst: record.pointsAgainst ?? 0,
      // ESPN's playoffSeed is computed from the regular season, which is
      // exactly what regularSeasonRank means here.
      regularSeasonRank: espnTeam.playoffSeed ?? null,
      finalRank: espnTeam.rankCalculatedFinal ?? null,
      madePlayoffs,
      playoffSeed: espnTeam.playoffSeed ?? null,
      isChampion: championEspnTeamId != null && espnTeam.id === championEspnTeamId,
    };

    const row = await prisma.fantasyTeam.upsert({
      where: { seasonId_managerId: { seasonId: season.id, managerId: owner.managerId } },
      create: { seasonId: season.id, managerId: owner.managerId, ...fields },
      update: fields,
      select: { id: true },
    });
    teamRowByEspnId.set(espnTeam.id, { id: row.id, managerId: owner.managerId, teamName });
    result.teams++;

    // Team-name history: one row per (manager, year, name).
    const alreadyNamed = await prisma.teamNameHistory.findFirst({
      where: { managerId: owner.managerId, seasonYear: year, name: teamName },
      select: { id: true },
    });
    if (!alreadyNamed) {
      await prisma.teamNameHistory.create({
        data: {
          managerId: owner.managerId,
          fantasyTeamId: row.id,
          name: teamName,
          seasonYear: year,
        },
      });
    }
  }

  // ── Matchups ─────────────────────────────────────────────────────────────
  // Playoff rounds are numbered from the final backwards so `playoffRound`
  // means the same thing regardless of how many rounds a season had.
  const playoffPeriods = [...new Set(playoffGames.map((m) => m.matchupPeriodId))].sort(
    (a, b) => a - b,
  );

  for (const matchup of schedule) {
    const home = teamRowByEspnId.get(matchup.home!.teamId);
    const away = teamRowByEspnId.get(matchup.away!.teamId);
    if (!home || !away) continue;

    const tier = matchup.playoffTierType;
    const isPlayoff = !!tier && tier !== "NONE";
    const bracketType = bracketFromTier(tier);
    const periodIndex = playoffPeriods.indexOf(matchup.matchupPeriodId);
    const roundsFromEnd = isPlayoff ? playoffPeriods.length - 1 - periodIndex : 0;
    const isFinalRound = isPlayoff && matchup.matchupPeriodId === championshipRound;

    const homeScore = matchup.home?.totalPoints ?? null;
    const awayScore = matchup.away?.totalPoints ?? null;
    const hasScores = homeScore != null && awayScore != null;

    const matchupFields = {
      week: matchup.matchupPeriodId,
      isPlayoff,
      playoffRound: isPlayoff ? roundsFromEnd + 1 : null,
      bracketType: bracketType ?? null,
      roundName: isPlayoff && tier ? roundName(tier, roundsFromEnd, isFinalRound) : null,
      status: hasScores ? ("FINAL" as const) : ("SCHEDULED" as const),
    };

    const row = await prisma.matchup.upsert({
      where: { seasonId_espnMatchupId: { seasonId: season.id, espnMatchupId: matchup.id } },
      create: { seasonId: season.id, espnMatchupId: matchup.id, ...matchupFields },
      update: matchupFields,
      select: { id: true },
    });

    for (const [team, score, opponentScore] of [
      [home, homeScore, awayScore],
      [away, awayScore, homeScore],
    ] as const) {
      const isWinner =
        matchup.winner === "UNDECIDED" || !hasScores
          ? null
          : score! > opponentScore!
            ? true
            : score! < opponentScore!
              ? false
              : null;
      await prisma.matchupTeam.upsert({
        where: { matchupId_fantasyTeamId: { matchupId: row.id, fantasyTeamId: team.id } },
        create: { matchupId: row.id, fantasyTeamId: team.id, score, isWinner },
        // benchPoints stays null: ESPN does not expose per-week bench scoring
        // for archived seasons (see the roster note below).
        update: { score, isWinner },
      });
    }

    result.matchups++;
    if (isPlayoff) {
      result.playoffMatchups++;
      if (bracketType) {
        await prisma.playoffBracket.upsert({
          where: { matchupId: row.id },
          create: {
            seasonId: season.id,
            round: roundsFromEnd + 1,
            bracketType,
            roundName: matchupFields.roundName ?? "Playoffs",
            matchupId: row.id,
          },
          update: {
            round: roundsFromEnd + 1,
            bracketType,
            roundName: matchupFields.roundName ?? "Playoffs",
          },
        });
      }
    }
  }

  // ── Week-by-week standings ───────────────────────────────────────────────
  // StandingSnapshot is insert-only by design, so ESPN rows for this season are
  // cleared first and rebuilt from the regular-season results. This is a
  // reconstruction of the standings after each week, not a capture made at the
  // time — the only honest option for a season that ended years ago.
  await prisma.standingSnapshot.deleteMany({ where: { seasonId: season.id } });

  interface Running {
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
    pointsAgainst: number;
    streak: { type: "W" | "L" | "T"; count: number } | null;
  }
  const running = new Map<string, Running>();
  for (const team of teamRowByEspnId.values()) {
    running.set(team.id, {
      wins: 0,
      losses: 0,
      ties: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      streak: null,
    });
  }

  const regularWeeks = [
    ...new Set(
      schedule.filter((m) => m.matchupPeriodId <= regularSeasonWeeks).map((m) => m.matchupPeriodId),
    ),
  ].sort((a, b) => a - b);

  for (const week of regularWeeks) {
    for (const matchup of schedule.filter((m) => m.matchupPeriodId === week)) {
      const home = teamRowByEspnId.get(matchup.home!.teamId);
      const away = teamRowByEspnId.get(matchup.away!.teamId);
      if (!home || !away) continue;
      const homeScore = matchup.home?.totalPoints;
      const awayScore = matchup.away?.totalPoints;
      if (homeScore == null || awayScore == null) continue;

      for (const [team, score, opponentScore] of [
        [home, homeScore, awayScore],
        [away, awayScore, homeScore],
      ] as const) {
        const state = running.get(team.id);
        if (!state) continue;
        state.pointsFor += score;
        state.pointsAgainst += opponentScore;
        const outcome: "W" | "L" | "T" =
          score > opponentScore ? "W" : score < opponentScore ? "L" : "T";
        if (outcome === "W") state.wins++;
        else if (outcome === "L") state.losses++;
        else state.ties++;
        state.streak =
          state.streak && state.streak.type === outcome
            ? { type: outcome, count: state.streak.count + 1 }
            : { type: outcome, count: 1 };
      }
    }

    // Rank on win percentage, then total points — the league's own tiebreak
    // (`playoffSeedingRule: TOTAL_POINTS_SCORED`).
    const ordered = [...running.entries()]
      .map(([fantasyTeamId, state]) => {
        const games = state.wins + state.losses + state.ties;
        return {
          fantasyTeamId,
          state,
          pct: games === 0 ? 0 : (state.wins + state.ties * 0.5) / games,
        };
      })
      .sort((a, b) => b.pct - a.pct || b.state.pointsFor - a.state.pointsFor);

    for (const [index, entry] of ordered.entries()) {
      await prisma.standingSnapshot.create({
        data: {
          seasonId: season.id,
          fantasyTeamId: entry.fantasyTeamId,
          week,
          wins: entry.state.wins,
          losses: entry.state.losses,
          ties: entry.state.ties,
          pointsFor: Number(entry.state.pointsFor.toFixed(2)),
          pointsAgainst: Number(entry.state.pointsAgainst.toFixed(2)),
          rank: index + 1,
          streak: entry.state.streak
            ? `${entry.state.streak.type}${entry.state.streak.count}`
            : null,
        },
      });
      result.standingSnapshots++;
    }
  }

  // ── Championship ─────────────────────────────────────────────────────────
  const championTeam =
    championEspnTeamId != null ? teamRowByEspnId.get(championEspnTeamId) : undefined;
  if (championTeam) {
    const runnerUpTeam =
      runnerUpEspnTeamId != null ? teamRowByEspnId.get(runnerUpEspnTeamId) : undefined;
    const thirdTeam =
      thirdPlaceEspnTeamId != null ? teamRowByEspnId.get(thirdPlaceEspnTeamId) : undefined;
    await prisma.championship.upsert({
      where: { seasonId: season.id },
      create: {
        seasonId: season.id,
        championFantasyTeamId: championTeam.id,
        championManagerId: championTeam.managerId,
        runnerUpFantasyTeamId: runnerUpTeam?.id ?? null,
        thirdPlaceFantasyTeamId: thirdTeam?.id ?? null,
      },
      update: {
        championFantasyTeamId: championTeam.id,
        championManagerId: championTeam.managerId,
        runnerUpFantasyTeamId: runnerUpTeam?.id ?? null,
        thirdPlaceFantasyTeamId: thirdTeam?.id ?? null,
      },
    });
    result.champion = championTeam.teamName;
    result.runnerUp = runnerUpTeam?.teamName;
    result.thirdPlace = thirdTeam?.teamName;
  }

  // ── Players (needed by both the draft and the rosters) ───────────────────
  const playerRowByEspnId = new Map<number, string>();
  const seenEspnPlayers = new Map<
    number,
    { firstName: string; lastName: string; position?: string; nflTeam?: string }
  >();

  function noteEspnPlayer(player: EspnPlayer) {
    const [first, ...rest] = (player.fullName ?? "").split(" ");
    const firstName = player.firstName?.trim() || first || "";
    const lastName = player.lastName?.trim() || rest.join(" ") || "";
    if (!firstName && !lastName) return;
    seenEspnPlayers.set(player.id, {
      firstName,
      lastName,
      position: positionFromEspn(player.defaultPositionId),
      nflTeam: proTeamFromEspn(player.proTeamId),
    });
  }

  for (const espnTeam of espnTeams) {
    for (const entry of espnTeam.roster?.entries ?? []) {
      if (entry.playerPoolEntry?.player) noteEspnPlayer(entry.playerPoolEntry.player);
    }
  }

  // The archived league views only describe players still rostered at season
  // end, so drafted-then-dropped players arrive as a bare id. Look those up
  // separately rather than storing picks with a null player.
  const draftedIds = (data.draftDetail?.picks ?? [])
    .map((p) => p.playerId)
    .filter((id) => id != null);
  const missingIds = [...new Set(draftedIds.filter((id) => !seenEspnPlayers.has(id)))];
  if (missingIds.length > 0) {
    const looked = await fetchPlayers(year, missingIds);
    for (const player of looked) noteEspnPlayer(player);
    const stillMissing = missingIds.filter((id) => !seenEspnPlayers.has(id));
    if (stillMissing.length > 0) {
      result.warnings.push(
        `${stillMissing.length} drafted player(s) could not be identified by ESPN even by direct lookup — those picks keep a null player`,
      );
    }
  }

  for (const [espnPlayerId, info] of seenEspnPlayers) {
    if (!info.firstName && !info.lastName) continue;
    const existingById = await prisma.fantasyPlayer.findUnique({
      where: { espnPlayerId },
      select: { id: true },
    });
    if (existingById) {
      playerRowByEspnId.set(espnPlayerId, existingById.id);
      continue;
    }
    // Attach to an existing (Sleeper-era) row only on an unambiguous
    // name+position match, so the same human is one row across both eras.
    // Two players sharing a name and position are left as separate rows.
    const nameMatches = await prisma.fantasyPlayer.findMany({
      where: {
        firstName: { equals: info.firstName, mode: "insensitive" },
        lastName: { equals: info.lastName, mode: "insensitive" },
        ...(info.position ? { position: info.position } : {}),
        espnPlayerId: null,
      },
      select: { id: true },
      take: 2,
    });
    if (nameMatches.length === 1) {
      await prisma.fantasyPlayer.update({
        where: { id: nameMatches[0].id },
        data: { espnPlayerId },
      });
      playerRowByEspnId.set(espnPlayerId, nameMatches[0].id);
      continue;
    }
    const created = await prisma.fantasyPlayer.create({
      data: {
        espnPlayerId,
        firstName: info.firstName,
        lastName: info.lastName,
        position: info.position ?? "UNK",
        nflTeam: info.nflTeam ?? null,
      },
      select: { id: true },
    });
    playerRowByEspnId.set(espnPlayerId, created.id);
    result.players++;
  }

  // ── Draft ────────────────────────────────────────────────────────────────
  const picks = (data.draftDetail?.picks ?? []).filter(
    (p) => p.teamId && teamRowByEspnId.has(p.teamId),
  );
  if (picks.length > 0) {
    const rounds = Math.max(...picks.map((p) => p.roundId));
    const draftDate = data.settings?.draftSettings?.date;
    const draft = await prisma.draft.upsert({
      where: { seasonId: season.id },
      create: {
        seasonId: season.id,
        type: draftTypeFromEspn(data.settings?.draftSettings?.type),
        rounds,
        startedAt: draftDate ? new Date(draftDate) : null,
        completedAt: data.draftDetail?.drafted ? (draftDate ? new Date(draftDate) : null) : null,
      },
      update: {
        type: draftTypeFromEspn(data.settings?.draftSettings?.type),
        rounds,
        startedAt: draftDate ? new Date(draftDate) : null,
      },
      select: { id: true },
    });

    for (const pick of picks) {
      const team = teamRowByEspnId.get(pick.teamId)!;
      // ESPN does not report the original owner of a traded pick in archived
      // seasons, so the drafting team is recorded as both. It is the only value
      // the API actually supports.
      const fields = {
        round: pick.roundId,
        pickNumber: pick.overallPickNumber,
        draftSlot: pick.roundPickNumber,
        originalFantasyTeamId: team.id,
        fantasyTeamId: team.id,
        managerId: team.managerId,
        playerId: playerRowByEspnId.get(pick.playerId) ?? null,
        isKeeper: pick.keeper ?? false,
        auctionAmount: pick.bidAmount && pick.bidAmount > 0 ? pick.bidAmount : null,
      };
      await prisma.draftPick.upsert({
        where: { draftId_pickNumber: { draftId: draft.id, pickNumber: pick.overallPickNumber } },
        create: { draftId: draft.id, ...fields },
        update: fields,
      });
      result.draftPicks++;
    }

    const unmatchedPlayers = picks.filter((p) => !playerRowByEspnId.has(p.playerId)).length;
    if (unmatchedPlayers > 0) {
      result.warnings.push(
        `${unmatchedPlayers} draft pick(s) reference a player ESPN no longer describes — the pick is kept, the player left null`,
      );
    }
  } else if (data.draftDetail?.drafted) {
    result.warnings.push("ESPN reports a completed draft but returned no picks");
  }

  // ── Season-end rosters ───────────────────────────────────────────────────
  // ESPN's archived `mRoster` view returns the roster as it stood at the end of
  // the season. Its only points field (`appliedStatTotal`) aggregates the final
  // TWO scoring periods — verified against the 2022 schedule, where the
  // starters' totals equal week 16 + week 17 rather than either week alone. So
  // membership, lineup slot and starter/bench are recorded and `points` is left
  // null. WeeklyPlayerScore.points is nullable precisely so this stays honest.
  const finalWeek = data.status?.finalScoringPeriod ?? regularSeasonWeeks;
  for (const espnTeam of espnTeams) {
    const team = teamRowByEspnId.get(espnTeam.id);
    const entries = espnTeam.roster?.entries ?? [];
    if (!team || entries.length === 0) continue;

    const roster = await prisma.roster.upsert({
      where: { fantasyTeamId_week: { fantasyTeamId: team.id, week: finalWeek } },
      create: { fantasyTeamId: team.id, week: finalWeek },
      update: { syncedAt: new Date() },
      select: { id: true },
    });
    result.rosters++;

    for (const entry of entries) {
      const playerId = playerRowByEspnId.get(entry.playerId);
      if (!playerId) continue;
      const fields = {
        lineupSlot: slotFromEspn(entry.lineupSlotId),
        isStarter: isStartingSlot(entry.lineupSlotId),
        points: null,
        projectedPoints: null,
      };
      await prisma.weeklyPlayerScore.upsert({
        where: { rosterId_playerId: { rosterId: roster.id, playerId } },
        create: { rosterId: roster.id, playerId, ...fields },
        update: fields,
      });
      result.rosterPlayers++;
    }
  }

  // ── Transactions ─────────────────────────────────────────────────────────
  // ESPN does not retain transaction logs for completed seasons. Verified for
  // 2017-2022 on every documented route: `view=mTransactions2` (with and
  // without a valid X-Fantasy-Filter), the per-season and leagueHistory paths,
  // the `/transactions/` resource and `kona_league_communication` all answer
  // HTTP 200 with no `transactions` key at all, and archived roster entries
  // carry `acquisitionType: null`. There is nothing to import, so nothing is
  // written — waivers, free-agent moves and trades for these seasons are
  // genuinely unavailable rather than empty.
  if (Array.isArray(data.transactions) && data.transactions.length > 0) {
    result.warnings.push(
      `ESPN unexpectedly returned ${data.transactions.length} transaction(s) for ${year}; the importer does not yet map them`,
    );
  }

  return result;
}
