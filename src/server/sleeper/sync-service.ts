// Sync skeleton: pulls data from whichever SleeperProvider is active (real
// or mock — see ./provider) and upserts it into Prisma. This is a Phase 1
// foundation: the structure, Prisma calls, and DataSyncLog bookkeeping are
// meant to be correct and to run cleanly against the mock provider; the
// real-Sleeper-to-Prisma field mapping has documented TODOs for edge cases
// (trade-aware draft pick ownership, lineup slot mapping, etc.) that a later
// phase will fill in once a real league id is configured.

import { prisma } from "@/lib/db";
import {
  SyncType,
  SyncStatus,
  SeasonStatus,
  TransactionType,
  TransactionStatus,
  DraftType,
} from "@/generated/prisma/client";
import { getSleeperProvider, type SleeperProvider } from "./provider";
import type { SleeperMatchup } from "./types";

// ---------------------------------------------------------------------------
// Shared DataSyncLog bookkeeping
// ---------------------------------------------------------------------------

interface SyncLogMeta {
  seasonId?: string;
  week?: number;
}

interface SyncOutcome<T> {
  recordsProcessed: number;
  result: T;
}

/**
 * Wraps a sync step with the create-RUNNING / update-SUCCESS-or-FAILED
 * DataSyncLog lifecycle every sync function needs, so each exported function
 * below only has to describe its own work.
 */
async function withSyncLog<T>(
  syncType: SyncType,
  meta: SyncLogMeta,
  fn: () => Promise<SyncOutcome<T>>
): Promise<T> {
  const log = await prisma.dataSyncLog.create({
    data: {
      syncType,
      seasonId: meta.seasonId,
      week: meta.week,
      status: SyncStatus.RUNNING,
    },
  });

  try {
    const { recordsProcessed, result } = await fn();
    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: {
        status: SyncStatus.SUCCESS,
        finishedAt: new Date(),
        recordsProcessed,
      },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.dataSyncLog.update({
      where: { id: log.id },
      data: {
        status: SyncStatus.FAILED,
        errorMessage: message,
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sleeper enum -> Prisma enum mapping helpers
// ---------------------------------------------------------------------------

function mapSeasonStatus(status: string): SeasonStatus {
  if (status === "complete") return SeasonStatus.COMPLETE;
  if (status === "in_season" || status === "drafting") return SeasonStatus.IN_PROGRESS;
  return SeasonStatus.UPCOMING;
}

function mapTransactionType(type: string): TransactionType {
  switch (type) {
    case "waiver":
      return TransactionType.WAIVER;
    case "trade":
      return TransactionType.TRADE;
    case "commissioner":
      return TransactionType.COMMISSIONER;
    case "free_agent":
    default:
      return TransactionType.FREE_AGENT;
  }
}

function mapTransactionStatus(status: string): TransactionStatus {
  switch (status) {
    case "pending":
      return TransactionStatus.PENDING;
    case "failed":
      return TransactionStatus.FAILED;
    case "complete":
    default:
      return TransactionStatus.COMPLETE;
  }
}

function mapDraftType(type: string): DraftType {
  switch (type) {
    case "linear":
      return DraftType.LINEAR;
    case "auction":
      return DraftType.AUCTION;
    case "snake":
    default:
      return DraftType.SNAKE;
  }
}

/**
 * A `Season` row's `sleeperLeagueId` is the real link to Sleeper. When it's
 * not set (e.g. seed/dev data with no real league configured yet), we still
 * want the mock provider to work end to end, so fall back to a placeholder —
 * the mock provider ignores its `leagueId` argument entirely, and the real
 * client will simply 404 (expected: a real season needs a real id).
 */
function resolveSleeperLeagueId(season: { sleeperLeagueId: string | null }): string {
  return season.sleeperLeagueId ?? "mock";
}

function weeksFor(season: { regularSeasonWeeks: number }): number[] {
  return Array.from({ length: season.regularSeasonWeeks }, (_, i) => i + 1);
}

// ---------------------------------------------------------------------------
// Core sync steps (no logging — composed by the exported functions below)
// ---------------------------------------------------------------------------

/** Upserts Manager + FantasyTeam rows for every roster in the league. Returns the number of teams written. */
async function coreSyncTeams(seasonId: string, sleeperLeagueId: string, provider: SleeperProvider): Promise<number> {
  const [users, rosters] = await Promise.all([
    provider.getLeagueUsers(sleeperLeagueId),
    provider.getRosters(sleeperLeagueId),
  ]);
  const usersById = new Map(users.map((u) => [u.user_id, u]));

  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (const roster of rosters) {
      if (!roster.owner_id) continue; // orphaned roster with no owner — nothing sensible to link it to

      const sleeperUser = usersById.get(roster.owner_id);
      const teamName =
        sleeperUser?.metadata?.team_name ?? sleeperUser?.display_name ?? sleeperUser?.username ?? `Roster ${roster.roster_id}`;

      const manager = await tx.manager.upsert({
        where: { sleeperUserId: roster.owner_id },
        update: {
          displayName: sleeperUser?.display_name ?? sleeperUser?.username ?? teamName,
          avatarUrl: sleeperUser?.avatar ?? null,
        },
        create: {
          sleeperUserId: roster.owner_id,
          displayName: sleeperUser?.display_name ?? sleeperUser?.username ?? teamName,
          avatarUrl: sleeperUser?.avatar ?? null,
          // TODO: derive from the earliest synced season for this manager once
          // multi-season historical sync is wired up, instead of "this year".
          joinedYear: new Date().getFullYear(),
        },
      });

      await tx.fantasyTeam.upsert({
        where: { seasonId_managerId: { seasonId, managerId: manager.id } },
        update: {
          sleeperRosterId: String(roster.roster_id),
          // TODO: only write a TeamNameHistory row when the name actually
          // changes, instead of overwriting teamName unconditionally.
          teamName,
          wins: roster.settings.wins,
          losses: roster.settings.losses,
          ties: roster.settings.ties,
          pointsFor: roster.settings.fpts,
          pointsAgainst: roster.settings.fpts_against ?? 0,
        },
        create: {
          seasonId,
          managerId: manager.id,
          sleeperRosterId: String(roster.roster_id),
          teamName,
          wins: roster.settings.wins,
          losses: roster.settings.losses,
          ties: roster.settings.ties,
          pointsFor: roster.settings.fpts,
          pointsAgainst: roster.settings.fpts_against ?? 0,
        },
      });
      count += 1;
    }
  });

  return count;
}

/** Replaces Matchup + MatchupTeam rows for one week with fresh data from the provider. Returns the number of team-sides written. */
async function coreSyncWeek(
  seasonId: string,
  sleeperLeagueId: string,
  week: number,
  provider: SleeperProvider
): Promise<number> {
  const [matchups, teams] = await Promise.all([
    provider.getMatchups(sleeperLeagueId, week),
    prisma.fantasyTeam.findMany({ where: { seasonId }, select: { id: true, sleeperRosterId: true } }),
  ]);
  const teamByRosterId = new Map(teams.filter((t) => t.sleeperRosterId).map((t) => [t.sleeperRosterId as string, t.id]));

  // Group by Sleeper's matchup_id so each group becomes one Matchup row with
  // (usually) two MatchupTeam sides. A null matchup_id (a bye) still gets its
  // own single-team group, keyed negatively so it can't collide with a real id.
  const groups = new Map<number, SleeperMatchup[]>();
  for (const m of matchups) {
    const key = m.matchup_id ?? -1 - m.roster_id;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }

  let count = 0;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.matchup.findMany({ where: { seasonId, week }, select: { id: true } });
    if (existing.length > 0) {
      const existingIds = existing.map((m) => m.id);
      await tx.matchupTeam.deleteMany({ where: { matchupId: { in: existingIds } } });
      await tx.matchup.deleteMany({ where: { id: { in: existingIds } } });
    }

    for (const [matchupKey, group] of groups) {
      const matchup = await tx.matchup.create({
        data: {
          seasonId,
          week,
          sleeperMatchupId: matchupKey >= 0 ? String(matchupKey) : null,
          // TODO: derive SCHEDULED / IN_PROGRESS / FINAL from the league's
          // current week/status instead of assuming every synced week is final.
          status: "FINAL",
        },
      });

      const scores = group.map((m) => m.points ?? 0);
      const topScore = Math.max(...scores);
      for (const m of group) {
        const fantasyTeamId = teamByRosterId.get(String(m.roster_id));
        if (!fantasyTeamId) continue; // roster not yet synced — run coreSyncTeams first

        await tx.matchupTeam.create({
          data: {
            matchupId: matchup.id,
            fantasyTeamId,
            score: m.points,
            isWinner: group.length > 1 ? (m.points ?? 0) === topScore : null,
          },
        });
        count += 1;
      }
    }
  });

  return count;
}

/** Upserts Transaction + TransactionAsset rows for the given weeks. Returns the number of assets written. */
async function coreSyncTransactions(
  seasonId: string,
  sleeperLeagueId: string,
  weeks: number[],
  provider: SleeperProvider
): Promise<number> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { seasonId },
    select: { id: true, managerId: true, sleeperRosterId: true },
  });
  const teamByRosterId = new Map(teams.filter((t) => t.sleeperRosterId).map((t) => [t.sleeperRosterId as string, t]));

  let count = 0;
  for (const week of weeks) {
    const weekTransactions = await provider.getTransactions(sleeperLeagueId, week);

    for (const txn of weekTransactions) {
      await prisma.$transaction(async (tx) => {
        let transactionRow = await tx.transaction.findFirst({
          where: { seasonId, sleeperTransactionId: txn.transaction_id },
        });

        const data = {
          week,
          type: mapTransactionType(txn.type),
          status: mapTransactionStatus(txn.status),
          faabSpent: txn.settings?.waiver_bid ?? null,
        };

        if (transactionRow) {
          transactionRow = await tx.transaction.update({ where: { id: transactionRow.id }, data });
          // Re-syncing: drop the old assets and rebuild from the latest payload.
          await tx.transactionAsset.deleteMany({ where: { transactionId: transactionRow.id } });
        } else {
          transactionRow = await tx.transaction.create({
            data: { seasonId, sleeperTransactionId: txn.transaction_id, ...data },
          });
        }

        // Sleeper's adds/drops maps are keyed by player_id -> roster_id.
        for (const [playerSleeperId, rosterId] of Object.entries(txn.adds ?? {})) {
          const team = teamByRosterId.get(String(rosterId));
          if (!team) continue;
          const player = await tx.fantasyPlayer.upsert({
            where: { sleeperPlayerId: playerSleeperId },
            update: {},
            // TODO: enrich with real metadata from provider.getAllPlayers()
            // instead of these placeholders once a player-catalog sync exists.
            create: { sleeperPlayerId: playerSleeperId, firstName: "Unknown", lastName: "Player", position: "UNK" },
          });
          await tx.transactionAsset.create({
            data: {
              transactionId: transactionRow.id,
              fantasyTeamId: team.id,
              managerId: team.managerId,
              direction: "ADD",
              assetType: "PLAYER",
              playerId: player.id,
            },
          });
          count += 1;
        }

        for (const [playerSleeperId, rosterId] of Object.entries(txn.drops ?? {})) {
          const team = teamByRosterId.get(String(rosterId));
          if (!team) continue;
          const player = await tx.fantasyPlayer.upsert({
            where: { sleeperPlayerId: playerSleeperId },
            update: {},
            create: { sleeperPlayerId: playerSleeperId, firstName: "Unknown", lastName: "Player", position: "UNK" },
          });
          await tx.transactionAsset.create({
            data: {
              transactionId: transactionRow.id,
              fantasyTeamId: team.id,
              managerId: team.managerId,
              direction: "DROP",
              assetType: "PLAYER",
              playerId: player.id,
            },
          });
          count += 1;
        }

        if (data.type === TransactionType.TRADE) {
          await tx.trade.upsert({
            where: { transactionId: transactionRow.id },
            update: {},
            create: { transactionId: transactionRow.id },
          });
        }

        // TODO: FAAB-only waiver_budget transfers and draft-pick assets
        // (txn.draft_picks / txn.waiver_budget) aren't modeled yet — deferred
        // to a follow-up pass once trade-retrospective content needs them.
      });
    }
  }

  return count;
}

/** Upserts the season's Draft + DraftPick rows. Returns the number of picks written. */
async function coreSyncDraft(seasonId: string, sleeperLeagueId: string, provider: SleeperProvider): Promise<number> {
  const drafts = await provider.getDrafts(sleeperLeagueId);
  // Schema allows exactly one Draft per season (`@@unique([seasonId])`); if a
  // league somehow has multiple drafts for one season, only the first is
  // synced. TODO: revisit if that ever needs to be modeled.
  const draftData = drafts[0];
  if (!draftData) return 0;

  const picks = await provider.getDraftPicks(draftData.draft_id);
  const teams = await prisma.fantasyTeam.findMany({
    where: { seasonId },
    select: { id: true, managerId: true, sleeperRosterId: true },
  });
  const teamByRosterId = new Map(teams.filter((t) => t.sleeperRosterId).map((t) => [t.sleeperRosterId as string, t]));

  let count = 0;
  await prisma.$transaction(async (tx) => {
    const draftRow = await tx.draft.upsert({
      where: { seasonId },
      update: {
        sleeperDraftId: draftData.draft_id,
        type: mapDraftType(draftData.type),
        rounds: draftData.settings.rounds,
        startedAt: draftData.start_time ? new Date(draftData.start_time) : null,
        completedAt: draftData.status === "complete" ? new Date() : null,
      },
      create: {
        seasonId,
        sleeperDraftId: draftData.draft_id,
        type: mapDraftType(draftData.type),
        rounds: draftData.settings.rounds,
        startedAt: draftData.start_time ? new Date(draftData.start_time) : null,
        completedAt: draftData.status === "complete" ? new Date() : null,
      },
    });

    for (const pick of picks) {
      const team = teamByRosterId.get(String(pick.roster_id));
      if (!team) continue; // roster not synced yet — run coreSyncTeams first

      let playerId: string | null = null;
      if (pick.player_id) {
        const player = await tx.fantasyPlayer.upsert({
          where: { sleeperPlayerId: pick.player_id },
          update: {},
          create: {
            sleeperPlayerId: pick.player_id,
            firstName: pick.metadata?.first_name ?? "Unknown",
            lastName: pick.metadata?.last_name ?? "Player",
            position: pick.metadata?.position ?? "UNK",
            nflTeam: pick.metadata?.team ?? null,
          },
        });
        playerId = player.id;
      }

      const pickData = {
        round: pick.round,
        draftSlot: pick.draft_slot,
        fantasyTeamId: team.id,
        // TODO: reconcile with provider.getTradedPicks() to find the true
        // original owner when a pick changed hands before the draft; for now
        // the current owner is also recorded as the original owner.
        originalFantasyTeamId: team.id,
        managerId: team.managerId,
        playerId,
        isKeeper: pick.is_keeper ?? false,
      };

      await tx.draftPick.upsert({
        where: { draftId_pickNumber: { draftId: draftRow.id, pickNumber: pick.pick_no } },
        update: pickData,
        create: { draftId: draftRow.id, pickNumber: pick.pick_no, ...pickData },
      });
      count += 1;
    }
  });

  return count;
}

/** Recomputes win/loss/points aggregates and a StandingSnapshot for one season from its regular-season Matchup data. */
async function coreRecalculateSeason(seasonId: string): Promise<number> {
  const matchups = await prisma.matchup.findMany({
    where: { seasonId, isPlayoff: false },
    include: { teams: true },
  });

  interface Agg {
    wins: number;
    losses: number;
    ties: number;
    pointsFor: number;
    pointsAgainst: number;
  }
  const statsByTeam = new Map<string, Agg>();
  const ensure = (id: string): Agg => {
    const existing = statsByTeam.get(id);
    if (existing) return existing;
    const fresh: Agg = { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 };
    statsByTeam.set(id, fresh);
    return fresh;
  };

  let maxWeek = 0;
  for (const matchup of matchups) {
    maxWeek = Math.max(maxWeek, matchup.week);
    if (matchup.teams.length !== 2) continue; // byes / malformed groups — nothing to compare against

    const [a, b] = matchup.teams;
    const aScore = a.score ?? 0;
    const bScore = b.score ?? 0;
    const aStats = ensure(a.fantasyTeamId);
    const bStats = ensure(b.fantasyTeamId);
    aStats.pointsFor += aScore;
    aStats.pointsAgainst += bScore;
    bStats.pointsFor += bScore;
    bStats.pointsAgainst += aScore;

    if (aScore === bScore) {
      aStats.ties += 1;
      bStats.ties += 1;
    } else if (aScore > bScore) {
      aStats.wins += 1;
      bStats.losses += 1;
    } else {
      bStats.wins += 1;
      aStats.losses += 1;
    }
  }

  const ranked = [...statsByTeam.entries()].sort(([, a], [, b]) => {
    const aTotal = a.wins + a.losses + a.ties;
    const bTotal = b.wins + b.losses + b.ties;
    const aPct = aTotal > 0 ? (a.wins + a.ties * 0.5) / aTotal : 0;
    const bPct = bTotal > 0 ? (b.wins + b.ties * 0.5) / bTotal : 0;
    return bPct - aPct || b.pointsFor - a.pointsFor;
  });

  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < ranked.length; i += 1) {
      const [fantasyTeamId, stats] = ranked[i];
      await tx.fantasyTeam.update({
        where: { id: fantasyTeamId },
        data: {
          wins: stats.wins,
          losses: stats.losses,
          ties: stats.ties,
          pointsFor: stats.pointsFor,
          pointsAgainst: stats.pointsAgainst,
          regularSeasonRank: i + 1,
        },
      });

      // StandingSnapshot is insert-only by design (see schema comment) — every
      // recalculation captures a new point-in-time row rather than updating one.
      await tx.standingSnapshot.create({
        data: {
          seasonId,
          fantasyTeamId,
          week: maxWeek,
          wins: stats.wins,
          losses: stats.losses,
          ties: stats.ties,
          pointsFor: stats.pointsFor,
          pointsAgainst: stats.pointsAgainst,
          rank: i + 1,
        },
      });
      count += 1;
    }
  });

  return count;
}

// ---------------------------------------------------------------------------
// Public sync API
// ---------------------------------------------------------------------------

/**
 * Syncs the league's current season end to end: teams, every regular-season
 * week's matchups, transactions, and the draft. Resolves/creates the League
 * + Season rows from Sleeper first, using `SLEEPER_LEAGUE_ID` when configured
 * or a mock placeholder id otherwise (the mock provider ignores it).
 */
export async function syncCurrentLeague(): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.FULL_LEAGUE, {}, async () => {
    const provider = getSleeperProvider();
    const sleeperLeagueId = resolveSleeperLeagueId({ sleeperLeagueId: null });
    const leagueData = await provider.getLeague(sleeperLeagueId);
    const year = Number.parseInt(leagueData.season, 10) || new Date().getFullYear();

    const seasonRow = await prisma.$transaction(async (tx) => {
      const leagueRow = await tx.league.upsert({
        where: { sleeperLeagueId },
        update: { name: leagueData.name },
        create: { name: leagueData.name, sleeperLeagueId, foundedYear: year },
      });

      const season = await tx.season.upsert({
        where: { sleeperLeagueId },
        update: { year, status: mapSeasonStatus(leagueData.status), isCurrent: true },
        create: {
          leagueId: leagueRow.id,
          year,
          sleeperLeagueId,
          previousSleeperLeagueId: leagueData.previous_league_id,
          status: mapSeasonStatus(leagueData.status),
          playoffTeams: leagueData.settings.playoff_teams ?? 6,
          playoffStartWeek: leagueData.settings.playoff_week_start ?? 15,
          isCurrent: true,
        },
      });

      // Only one season per league should be flagged current at a time.
      await tx.season.updateMany({
        where: { leagueId: leagueRow.id, id: { not: season.id } },
        data: { isCurrent: false },
      });

      return season;
    });

    let recordsProcessed = await coreSyncTeams(seasonRow.id, sleeperLeagueId, provider);
    const weeks = weeksFor(seasonRow);
    for (const week of weeks) {
      recordsProcessed += await coreSyncWeek(seasonRow.id, sleeperLeagueId, week, provider);
    }
    recordsProcessed += await coreSyncTransactions(seasonRow.id, sleeperLeagueId, weeks, provider);
    recordsProcessed += await coreSyncDraft(seasonRow.id, sleeperLeagueId, provider);

    return { recordsProcessed, result: { seasonId: seasonRow.id, recordsProcessed } };
  });
}

/** Syncs one season end to end: teams, every regular-season week, transactions, and the draft. */
export async function syncSeason(seasonId: string): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.SEASON, { seasonId }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);

    let recordsProcessed = await coreSyncTeams(seasonId, sleeperLeagueId, provider);
    const weeks = weeksFor(season);
    for (const week of weeks) {
      recordsProcessed += await coreSyncWeek(seasonId, sleeperLeagueId, week, provider);
    }
    recordsProcessed += await coreSyncTransactions(seasonId, sleeperLeagueId, weeks, provider);
    recordsProcessed += await coreSyncDraft(seasonId, sleeperLeagueId, provider);

    return { recordsProcessed, result: { seasonId, recordsProcessed } };
  });
}

/** Syncs every Season row currently in the database, one at a time (each also gets its own SEASON-scoped log row). */
export async function syncAllSeasons(): Promise<{ seasonsProcessed: number }> {
  return withSyncLog(SyncType.FULL_LEAGUE, {}, async () => {
    const seasons = await prisma.season.findMany({ select: { id: true } });
    for (const season of seasons) {
      await syncSeason(season.id);
    }
    return { recordsProcessed: seasons.length, result: { seasonsProcessed: seasons.length } };
  });
}

/** Re-syncs a single week's matchups for one season. */
export async function syncWeek(seasonId: string, week: number): Promise<{ seasonId: string; week: number; recordsProcessed: number }> {
  return withSyncLog(SyncType.WEEK, { seasonId, week }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);
    const recordsProcessed = await coreSyncWeek(seasonId, sleeperLeagueId, week, provider);
    return { recordsProcessed, result: { seasonId, week, recordsProcessed } };
  });
}

/** Re-syncs every regular-season week's transactions for one season. */
export async function syncTransactions(seasonId: string): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.TRANSACTIONS, { seasonId }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);
    const recordsProcessed = await coreSyncTransactions(seasonId, sleeperLeagueId, weeksFor(season), provider);
    return { recordsProcessed, result: { seasonId, recordsProcessed } };
  });
}

/** Re-syncs the draft + draft picks for one season. */
export async function syncDrafts(seasonId: string): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.DRAFT, { seasonId }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);
    const recordsProcessed = await coreSyncDraft(seasonId, sleeperLeagueId, provider);
    return { recordsProcessed, result: { seasonId, recordsProcessed } };
  });
}

/** Recomputes FantasyTeam win/loss/points aggregates and a StandingSnapshot for every season, from already-synced Matchup data. Does not call Sleeper. */
export async function recalculateStatistics(): Promise<{ seasonsProcessed: number; recordsProcessed: number }> {
  return withSyncLog(SyncType.STATS_RECALC, {}, async () => {
    const seasons = await prisma.season.findMany({ select: { id: true } });
    let recordsProcessed = 0;
    for (const season of seasons) {
      recordsProcessed += await coreRecalculateSeason(season.id);
    }
    return { recordsProcessed, result: { seasonsProcessed: seasons.length, recordsProcessed } };
  });
}
