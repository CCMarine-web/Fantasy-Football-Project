// Sync skeleton: pulls data from whichever SleeperProvider is active (real
// or mock — see ./provider) and upserts it into Prisma. This is a Phase 1
// foundation: the structure, Prisma calls, and DataSyncLog bookkeeping are
// meant to be correct and to run cleanly against the mock provider; the
// real-Sleeper-to-Prisma field mapping has documented TODOs for edge cases
// (trade-aware draft pick ownership, lineup slot mapping, etc.) that a later
// phase will fill in once a real league id is configured.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { deriveFinalPlacements } from "./final-placements";
import { getEnv } from "@/lib/env";
import { deriveWeekStatus, type WeekStatus } from "@/lib/nfl-schedule";
import {
  SyncType,
  SyncStatus,
  SeasonStatus,
  TransactionType,
  TransactionStatus,
  DraftType,
} from "@/generated/prisma/client";
import { getSleeperProvider, type SleeperProvider } from "./provider";
import type { SleeperMatchup, SleeperPlayersMap } from "./types";

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

/** Regular-season weeks plus a fixed 3-week playoff window (quarterfinal/semifinal/final — Sleeper's standard bracket depth). */
function allWeeksFor(season: { regularSeasonWeeks: number; playoffStartWeek: number }): number[] {
  const weeks = weeksFor(season);
  for (let i = 0; i < 3; i += 1) weeks.push(season.playoffStartWeek + i);
  return [...new Set(weeks)];
}

/** Looks up a player's real name/position/team from the full NFL catalog, falling back to placeholders if absent. */
function resolvePlayerCreateData(
  catalog: SleeperPlayersMap,
  sleeperPlayerId: string
): { firstName: string; lastName: string; position: string; nflTeam: string | null } {
  const entry = catalog[sleeperPlayerId];
  if (!entry) {
    return { firstName: "Unknown", lastName: "Player", position: "UNK", nflTeam: null };
  }
  return {
    firstName: entry.first_name ?? entry.full_name?.split(" ")[0] ?? "Unknown",
    lastName: entry.last_name ?? entry.full_name?.split(" ").slice(1).join(" ") ?? "Player",
    position: entry.position ?? "UNK",
    nflTeam: entry.team,
  };
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

      // Sleeper hands back a bare avatar id, not a URL. Store the CDN URL so
      // the value is directly usable as an <img> src.
      const avatarUrl = sleeperUser?.avatar ? `https://sleepercdn.com/avatars/thumbs/${sleeperUser.avatar}` : null;

      const manager = await tx.manager.upsert({
        where: { sleeperUserId: roster.owner_id },
        update: {
          // displayName is deliberately NOT overwritten. The commissioner
          // curates real names (see scripts/import/seed-managers-identity.ts);
          // syncing used to clobber them back to Sleeper handles on every run.
          avatarUrl,
        },
        create: {
          sleeperUserId: roster.owner_id,
          displayName: sleeperUser?.display_name ?? sleeperUser?.username ?? teamName,
          avatarUrl,
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
  provider: SleeperProvider,
  isPlayoff = false,
  playersCatalog?: SleeperPlayersMap,
  status: WeekStatus = "FINAL"
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
  const rosterByFantasyTeam = new Map<string, string>(); // fantasyTeamId -> rosterId

  /*
   * `verifiedScore` is a human judgement, not synced data: it marks a score
   * that is on record but is not the result of a real contest (an abandoned
   * team, an unplayed week). Re-writing the week from Sleeper's data used to
   * silently reset every such flag back to true — so the weekly cron would
   * quietly re-admit an abandoned team's zeros to the record books a week after
   * an admin excluded them. The flags are read first and reapplied below.
   */
  const preservedVerification = new Map<string, boolean>();
  const priorTeams = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId, week }, verifiedScore: false },
    select: { fantasyTeamId: true },
  });
  for (const t of priorTeams) preservedVerification.set(t.fantasyTeamId, false);

  /*
   * Matchups are updated in place, keyed on Sleeper's matchup id, rather than
   * deleted and recreated. Generated previews and recaps are linked to a
   * Matchup by its id, so recreating the week every Tuesday orphaned every
   * piece of writing about it — and made the pipeline write it all again.
   */
  await prisma.$transaction(async (tx) => {
    const existing = await tx.matchup.findMany({ where: { seasonId, week }, select: { id: true, sleeperMatchupId: true } });
    const existingBySleeperId = new Map(
      existing.filter((m) => m.sleeperMatchupId != null).map((m) => [m.sleeperMatchupId as string, m.id]),
    );
    const kept = new Set<string>();

    for (const [matchupKey, group] of groups) {
      const sleeperMatchupId = matchupKey >= 0 ? String(matchupKey) : null;
      const priorId = sleeperMatchupId ? existingBySleeperId.get(sleeperMatchupId) : undefined;
      const matchup = priorId
        ? await tx.matchup.update({ where: { id: priorId }, data: { isPlayoff, status } })
        : await tx.matchup.create({ data: { seasonId, week, sleeperMatchupId, isPlayoff, status } });
      kept.add(matchup.id);

      // Sleeper reports 0 points for every week not yet played. Recording
      // those as scores put a season's worth of 0-0 "finals" into standings,
      // records and awards, so a score is only kept once the week is final.
      const final = status === "FINAL";
      const scores = group.map((m) => m.points ?? 0);
      const topScore = Math.max(...scores);
      const sides: string[] = [];
      for (const m of group) {
        const fantasyTeamId = teamByRosterId.get(String(m.roster_id));
        if (!fantasyTeamId) continue; // roster not yet synced — run coreSyncTeams first
        sides.push(fantasyTeamId);

        const side = {
          score: final ? m.points : null,
          isWinner: final && group.length > 1 ? (m.points ?? 0) === topScore : null,
          verifiedScore: preservedVerification.get(fantasyTeamId) ?? true,
        };
        await tx.matchupTeam.upsert({
          where: { matchupId_fantasyTeamId: { matchupId: matchup.id, fantasyTeamId } },
          update: side,
          create: { matchupId: matchup.id, fantasyTeamId, ...side },
        });
        count += 1;
      }
      await tx.matchupTeam.deleteMany({ where: { matchupId: matchup.id, fantasyTeamId: { notIn: sides } } });
    }

    // Matchups Sleeper no longer reports for this week.
    const stale = existing.map((m) => m.id).filter((id) => !kept.has(id));
    if (stale.length > 0) {
      await tx.playoffBracket.updateMany({ where: { matchupId: { in: stale } }, data: { matchupId: null } });
      await tx.matchupTeam.deleteMany({ where: { matchupId: { in: stale } } });
      await tx.matchup.deleteMany({ where: { id: { in: stale } } });
    }
  }, { timeout: 30_000 });

  // Player-level weekly scores (Roster + WeeklyPlayerScore). Sleeper exposes
  // per-player points on the matchup payload (players_points + starters); we
  // store them so bench-points, boom/bust, and trade-hindsight features work.
  // Done outside the matchup transaction, batched, and skipped gracefully when
  // a week has no player data.
  if (status !== "FINAL") {
    await clearWeekPlayerScores(week, [...teamByRosterId.values()]);
  } else if (playersCatalog) {
    await syncWeekPlayerScores(seasonId, week, matchups, teamByRosterId, playersCatalog, rosterByFantasyTeam);
  }

  return count;
}

type PlayerCreateData = { firstName: string; lastName: string; position: string; nflTeam: string | null };

/**
 * sleeperPlayerId -> FantasyPlayer.id for every id given, creating any that do
 * not exist yet in one batch. Three queries however many players, where the
 * per-player upsert it replaces cost a round trip each — thousands per weekly
 * sync, which is what pushed the cron to the edge of its time limit.
 * Existing players are never modified, matching the old `update: {}`.
 */
async function ensurePlayers(
  catalog: SleeperPlayersMap,
  sleeperIds: Iterable<string>,
  createData: (sleeperId: string) => PlayerCreateData = (id) => resolvePlayerCreateData(catalog, id)
): Promise<Map<string, string>> {
  const wanted = [...new Set(sleeperIds)];
  const byId = new Map<string, string>();
  if (wanted.length === 0) return byId;
  const lookup = async (ids: string[]) => {
    const rows = await prisma.fantasyPlayer.findMany({
      where: { sleeperPlayerId: { in: ids } },
      select: { id: true, sleeperPlayerId: true },
    });
    for (const r of rows) if (r.sleeperPlayerId) byId.set(r.sleeperPlayerId, r.id);
  };
  await lookup(wanted);
  const missing = wanted.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    await prisma.fantasyPlayer.createMany({
      data: missing.map((id) => ({ sleeperPlayerId: id, ...createData(id) })),
      skipDuplicates: true,
    });
    await lookup(missing);
  }
  return byId;
}

/** Removes a week's Roster + WeeklyPlayerScore rows — an unfinished week has no player scores to keep. */
async function clearWeekPlayerScores(week: number, fantasyTeamIds: string[]): Promise<void> {
  const rosters = await prisma.roster.findMany({
    where: { fantasyTeamId: { in: fantasyTeamIds }, week },
    select: { id: true },
  });
  if (rosters.length === 0) return;
  const ids = rosters.map((r) => r.id);
  await prisma.weeklyPlayerScore.deleteMany({ where: { rosterId: { in: ids } } });
  await prisma.roster.deleteMany({ where: { id: { in: ids } } });
}

/**
 * How far along each week of a Sleeper league is, from the league's own
 * status and scored-week marker plus Sleeper's NFL calendar. The calendar is
 * only trusted when it is for the same season as the league — a historical
 * league is judged on its own status alone.
 */
async function resolveWeekStatuses(
  sleeperLeagueId: string,
  provider: SleeperProvider
): Promise<(week: number) => WeekStatus> {
  const [league, state] = await Promise.all([
    provider.getLeague(sleeperLeagueId),
    provider.getNflState().catch(() => null),
  ]);
  const sameSeason = state != null && state.season === league.season;
  const nowMs = Date.now();
  return (week) =>
    deriveWeekStatus({
      week,
      nowMs,
      leagueComplete: league.status === "complete",
      lastScoredLeg: league.settings.last_scored_leg ?? null,
      seasonStartDate: sameSeason ? (state.season_start_date ?? null) : null,
      currentLeg: sameSeason && state.season_type === "regular" ? state.leg : null,
    });
}

/**
 * The weeks a routine sync of the current season has to touch. A week settled
 * more than a week ago (stat corrections land within a week) and a scheduled
 * week more than two weeks out are already on record exactly as Sleeper has
 * them; re-writing all seventeen every Tuesday is most of what made the sync
 * take four minutes. A week not yet on record, or whose status has moved, is
 * always synced. `syncSeason` still does every week, for a full rebuild.
 */
async function weeksNeedingSync(
  seasonId: string,
  weeks: number[],
  statusOf: (week: number) => WeekStatus
): Promise<number[]> {
  const stored = new Map(
    (
      await prisma.matchup.findMany({ where: { seasonId }, distinct: ["week"], select: { week: true, status: true } })
    ).map((m) => [m.week, m.status])
  );
  const finals = weeks.filter((w) => statusOf(w) === "FINAL");
  const latestFinal = finals.length > 0 ? Math.max(...finals) : 0;
  const nextUnplayed = weeks.find((w) => statusOf(w) !== "FINAL") ?? Number.POSITIVE_INFINITY;
  return weeks.filter((week) => {
    const status = statusOf(week);
    if (stored.get(week) !== status) return true;
    if (status === "FINAL") return week >= latestFinal - 1;
    if (status === "SCHEDULED") return week <= nextUnplayed + 2;
    return true;
  });
}

/** Persists Roster + WeeklyPlayerScore rows for one week from Sleeper's per-player matchup points. */
async function syncWeekPlayerScores(
  seasonId: string,
  week: number,
  matchups: SleeperMatchup[],
  teamByRosterId: Map<string, string>,
  catalog: SleeperPlayersMap,
  rosterByFantasyTeam: Map<string, string>
): Promise<void> {
  const withPlayers = matchups.filter((m) => m.players_points && Object.keys(m.players_points).length > 0);
  if (withPlayers.length === 0) return; // no player-level data this week — skip

  const fantasyTeamIds = matchups
    .map((m) => teamByRosterId.get(String(m.roster_id)))
    .filter((x): x is string => Boolean(x));

  // Ensure every referenced player exists (created from the catalog).
  // sleeperPlayerId -> FantasyPlayer.id
  const playerIdMap = await ensurePlayers(
    catalog,
    withPlayers.flatMap((m) => Object.keys(m.players_points!))
  );

  // Replace this week's rosters+scores for these teams.
  const existingRosters = await prisma.roster.findMany({
    where: { fantasyTeamId: { in: fantasyTeamIds }, week },
    select: { id: true },
  });
  if (existingRosters.length > 0) {
    const ids = existingRosters.map((r) => r.id);
    await prisma.weeklyPlayerScore.deleteMany({ where: { rosterId: { in: ids } } });
    await prisma.roster.deleteMany({ where: { id: { in: ids } } });
  }

  const rosterRows: { id: string; fantasyTeamId: string; week: number; sleeperRosterId: string }[] = [];
  const scoreRows: { id: string; rosterId: string; playerId: string; lineupSlot: string; isStarter: boolean; points: number }[] = [];
  for (const m of withPlayers) {
    const fantasyTeamId = teamByRosterId.get(String(m.roster_id));
    if (!fantasyTeamId) continue;
    const rosterId = randomUUID();
    rosterByFantasyTeam.set(fantasyTeamId, rosterId);
    rosterRows.push({ id: rosterId, fantasyTeamId, week, sleeperRosterId: String(m.roster_id) });
    const starters = new Set(m.starters ?? []);
    for (const [sleeperPid, points] of Object.entries(m.players_points!)) {
      const playerId = playerIdMap.get(sleeperPid);
      if (!playerId) continue;
      const isStarter = starters.has(sleeperPid);
      scoreRows.push({
        id: randomUUID(),
        rosterId,
        playerId,
        lineupSlot: isStarter ? (catalog[sleeperPid]?.position ?? "FLEX") : "BN",
        isStarter,
        points,
      });
    }
  }
  if (rosterRows.length) await prisma.roster.createMany({ data: rosterRows });
  if (scoreRows.length) {
    // Chunk to keep individual inserts well within limits.
    for (let i = 0; i < scoreRows.length; i += 500) {
      await prisma.weeklyPlayerScore.createMany({ data: scoreRows.slice(i, i + 500) });
    }
  }
}

/** Upserts Transaction + TransactionAsset rows for the given weeks. Returns the number of assets written. */
async function coreSyncTransactions(
  seasonId: string,
  sleeperLeagueId: string,
  weeks: number[],
  provider: SleeperProvider,
  playersCatalog: SleeperPlayersMap
): Promise<number> {
  const teams = await prisma.fantasyTeam.findMany({
    where: { seasonId },
    select: { id: true, managerId: true, sleeperRosterId: true },
  });
  const teamByRosterId = new Map(teams.filter((t) => t.sleeperRosterId).map((t) => [t.sleeperRosterId as string, t]));

  // A completed or failed transaction never changes again, so one already on
  // record in that state is left alone rather than rewritten every week.
  const known = new Map(
    (
      await prisma.transaction.findMany({
        where: { seasonId, sleeperTransactionId: { not: null } },
        select: { sleeperTransactionId: true, status: true },
      })
    ).map((t) => [t.sleeperTransactionId as string, t.status])
  );

  let count = 0;
  for (const week of weeks) {
    const weekTransactions = (await provider.getTransactions(sleeperLeagueId, week)).filter((txn) => {
      const prior = known.get(txn.transaction_id);
      const status = mapTransactionStatus(txn.status);
      return !(prior === status && status !== TransactionStatus.PENDING);
    });
    const playerIds = await ensurePlayers(
      playersCatalog,
      weekTransactions.flatMap((txn) => [...Object.keys(txn.adds ?? {}), ...Object.keys(txn.drops ?? {})])
    );

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
          const playerId = playerIds.get(playerSleeperId);
          if (!team || !playerId) continue;
          await tx.transactionAsset.create({
            data: {
              transactionId: transactionRow.id,
              fantasyTeamId: team.id,
              managerId: team.managerId,
              direction: "ADD",
              assetType: "PLAYER",
              playerId,
            },
          });
          count += 1;
        }

        for (const [playerSleeperId, rosterId] of Object.entries(txn.drops ?? {})) {
          const team = teamByRosterId.get(String(rosterId));
          const playerId = playerIds.get(playerSleeperId);
          if (!team || !playerId) continue;
          await tx.transactionAsset.create({
            data: {
              transactionId: transactionRow.id,
              fantasyTeamId: team.id,
              managerId: team.managerId,
              direction: "DROP",
              assetType: "PLAYER",
              playerId,
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
async function coreSyncDraft(
  seasonId: string,
  sleeperLeagueId: string,
  provider: SleeperProvider,
  playersCatalog: SleeperPlayersMap
): Promise<number> {
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

  // A finished draft that is already fully on record cannot change. Rewriting
  // it every week cost hundreds of round trips, reset its completion time to
  // "now", and would undo any hand correction made to a pick since.
  if (draftData.status === "complete") {
    const stored = await prisma.draft.findUnique({
      where: { seasonId },
      select: { sleeperDraftId: true, completedAt: true, _count: { select: { picks: true } } },
    });
    if (stored?.sleeperDraftId === draftData.draft_id && stored.completedAt && stored._count.picks >= picks.length) return 0;
  }

  const pickById = new Map(picks.map((p) => [p.player_id, p]));
  const playerIds = await ensurePlayers(
    playersCatalog,
    picks.map((p) => p.player_id).filter((id): id is string => Boolean(id)),
    (id) => {
      const catalogData = resolvePlayerCreateData(playersCatalog, id);
      const meta = pickById.get(id)?.metadata;
      return {
        firstName: meta?.first_name ?? catalogData.firstName,
        lastName: meta?.last_name ?? catalogData.lastName,
        position: meta?.position ?? catalogData.position,
        nflTeam: meta?.team ?? catalogData.nflTeam,
      };
    }
  );

  let count = 0;
  // A full draft can be 100+ picks, each needing a player upsert + pick
  // upsert — comfortably over Prisma's 5s default interactive-transaction
  // timeout, hence the generous explicit timeout here.
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

      const playerId = pick.player_id ? (playerIds.get(pick.player_id) ?? null) : null;

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
  }, { timeout: 60_000 });

  return count;
}

/**
 * Derives the champion/runner-up/third-place teams from Sleeper's winners
 * bracket and writes a `Championship` row plus the corresponding
 * `FantasyTeam.isChampion`/`finalRank`/`madePlayoffs` flags. Sleeper marks
 * the championship match with `p: 1` and the third-place match with `p: 3`
 * on whichever bracket entries represent those games; every roster that
 * appears anywhere in the bracket is flagged `madePlayoffs`. Returns the
 * number of FantasyTeam rows updated (0 if the season has no bracket yet,
 * e.g. still in progress).
 */
async function coreSyncPlayoffResults(seasonId: string, sleeperLeagueId: string, provider: SleeperProvider): Promise<number> {
  const bracket = await provider.getWinnersBracket(sleeperLeagueId);
  if (bracket.length === 0) return 0;

  const teams = await prisma.fantasyTeam.findMany({ where: { seasonId }, select: { id: true, sleeperRosterId: true } });
  const teamByRosterId = new Map(teams.filter((t) => t.sleeperRosterId).map((t) => [Number(t.sleeperRosterId), t.id]));

  const playoffRosterIds = new Set<number>();
  for (const m of bracket) {
    if (m.t1 != null) playoffRosterIds.add(m.t1);
    if (m.t2 != null) playoffRosterIds.add(m.t2);
  }

  const champMatch = bracket.find((m) => m.p === 1);
  const thirdMatch = bracket.find((m) => m.p === 3);

  // Full 1..N finishing order from both brackets, so every team gets a final
  // position instead of only the podium (see final-placements.ts).
  const season = await prisma.season.findUnique({ where: { id: seasonId }, select: { playoffTeams: true } });
  const losersBracket = await provider.getLosersBracket(sleeperLeagueId).catch(() => []);
  const placements = deriveFinalPlacements(
    bracket,
    losersBracket,
    season?.playoffTeams ?? 6,
    teams.length,
  );

  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (const rosterId of playoffRosterIds) {
      const fantasyTeamId = teamByRosterId.get(rosterId);
      if (!fantasyTeamId) continue;
      await tx.fantasyTeam.update({ where: { id: fantasyTeamId }, data: { madePlayoffs: true } });
      count += 1;
    }

    // Written before the podium updates below so those remain authoritative
    // for places 1-3 if the two ever disagreed.
    for (const [rosterId, place] of placements.byRosterId) {
      const fantasyTeamId = teamByRosterId.get(rosterId);
      if (!fantasyTeamId) continue;
      await tx.fantasyTeam.update({ where: { id: fantasyTeamId }, data: { finalRank: place } });
    }

    if (champMatch?.w != null && champMatch.l != null) {
      const championTeamId = teamByRosterId.get(champMatch.w);
      const runnerUpTeamId = teamByRosterId.get(champMatch.l);
      const thirdTeamId = thirdMatch?.w != null ? teamByRosterId.get(thirdMatch.w) : undefined;

      if (championTeamId) {
        await tx.fantasyTeam.update({ where: { id: championTeamId }, data: { isChampion: true, finalRank: 1 } });
        if (runnerUpTeamId) await tx.fantasyTeam.update({ where: { id: runnerUpTeamId }, data: { finalRank: 2 } });
        if (thirdTeamId) await tx.fantasyTeam.update({ where: { id: thirdTeamId }, data: { finalRank: 3 } });

        const championTeam = await tx.fantasyTeam.findUniqueOrThrow({ where: { id: championTeamId } });
        await tx.championship.upsert({
          where: { seasonId },
          update: {
            championFantasyTeamId: championTeamId,
            championManagerId: championTeam.managerId,
            runnerUpFantasyTeamId: runnerUpTeamId ?? null,
            thirdPlaceFantasyTeamId: thirdTeamId ?? null,
          },
          create: {
            seasonId,
            championFantasyTeamId: championTeamId,
            championManagerId: championTeam.managerId,
            runnerUpFantasyTeamId: runnerUpTeamId ?? null,
            thirdPlaceFantasyTeamId: thirdTeamId ?? null,
          },
        });
        count += 1;
      }
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
    const configuredLeagueId = getEnv().SLEEPER_LEAGUE_ID.trim();
    const sleeperLeagueId = configuredLeagueId.length > 0 ? configuredLeagueId : "mock";
    const leagueData = await provider.getLeague(sleeperLeagueId);
    const year = Number.parseInt(leagueData.season, 10) || new Date().getFullYear();

    const seasonRow = await prisma.$transaction(async (tx) => {
      // League is a singleton: every read in the app is `league.findFirst()`.
      // Sleeper issues a NEW league id for each season, so upserting League on
      // `sleeperLeagueId` created a second League row every year and silently
      // split the league's history across two roots. Reuse whatever League row
      // exists and only create one when the database is empty. The per-season
      // Sleeper id still lives on `Season.sleeperLeagueId`, which is the real
      // link to Sleeper (see resolveSleeperLeagueId).
      const existingLeague = await tx.league.findFirst({ orderBy: { createdAt: "asc" } });
      const leagueRow = existingLeague
        ? await tx.league.update({
            where: { id: existingLeague.id },
            // `foundedYear` is deliberately not touched: it may have been
            // corrected to an earlier, pre-Sleeper season by the ESPN import.
            data: { name: leagueData.name },
          })
        : await tx.league.create({
            data: { name: leagueData.name, sleeperLeagueId, foundedYear: year },
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
          regularSeasonWeeks: (leagueData.settings.playoff_week_start ?? 15) - 1,
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

    const playersCatalog = await provider.getAllPlayers();
    const statusOf = await resolveWeekStatuses(sleeperLeagueId, provider);
    let recordsProcessed = await coreSyncTeams(seasonRow.id, sleeperLeagueId, provider);
    const regularWeeks = weeksFor(seasonRow);
    const weeks = await weeksNeedingSync(seasonRow.id, allWeeksFor(seasonRow), statusOf);
    for (const week of weeks) {
      recordsProcessed += await coreSyncWeek(seasonRow.id, sleeperLeagueId, week, provider, week >= seasonRow.playoffStartWeek, playersCatalog, statusOf(week));
    }
    recordsProcessed += await coreSyncTransactions(seasonRow.id, sleeperLeagueId, regularWeeks, provider, playersCatalog);
    recordsProcessed += await coreSyncDraft(seasonRow.id, sleeperLeagueId, provider, playersCatalog);
    recordsProcessed += await coreSyncPlayoffResults(seasonRow.id, sleeperLeagueId, provider);

    return { recordsProcessed, result: { seasonId: seasonRow.id, recordsProcessed } };
  });
}

/** Syncs one season end to end: teams, every regular-season + playoff week, transactions, the draft, and playoff/championship results. */
export async function syncSeason(seasonId: string): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.SEASON, { seasonId }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);

    const playersCatalog = await provider.getAllPlayers();
    const statusOf = await resolveWeekStatuses(sleeperLeagueId, provider);
    let recordsProcessed = await coreSyncTeams(seasonId, sleeperLeagueId, provider);
    const regularWeeks = weeksFor(season);
    for (const week of allWeeksFor(season)) {
      recordsProcessed += await coreSyncWeek(seasonId, sleeperLeagueId, week, provider, week >= season.playoffStartWeek, playersCatalog, statusOf(week));
    }
    recordsProcessed += await coreSyncTransactions(seasonId, sleeperLeagueId, regularWeeks, provider, playersCatalog);
    recordsProcessed += await coreSyncDraft(seasonId, sleeperLeagueId, provider, playersCatalog);
    recordsProcessed += await coreSyncPlayoffResults(seasonId, sleeperLeagueId, provider);

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

/**
 * Discovers every historical season connected to the configured
 * `SLEEPER_LEAGUE_ID` by walking Sleeper's `previous_league_id` chain
 * (Sleeper models "the same league across years" as a linked list of
 * distinct league ids, one per season), creates a `League`+`Season` row for
 * any not already synced, then runs a full `syncSeason` for each — oldest
 * first, so the most recent season ends up correctly flagged `isCurrent`.
 */
export async function syncAllConnectedSeasons(): Promise<{ seasonsProcessed: number }> {
  return withSyncLog(SyncType.FULL_LEAGUE, {}, async () => {
    const provider = getSleeperProvider();
    const configuredLeagueId = getEnv().SLEEPER_LEAGUE_ID.trim();
    const rootLeagueId = configuredLeagueId.length > 0 ? configuredLeagueId : "mock";

    const chain = await provider.getLeagueHistoryChain(rootLeagueId); // current first, oldest last
    const oldestFirst = [...chain].reverse();

    let leagueRowId: string | null = null;
    const seasonIds: string[] = [];

    for (const sleeperLeagueId of oldestFirst) {
      const leagueData = await provider.getLeague(sleeperLeagueId);
      const year = Number.parseInt(leagueData.season, 10) || new Date().getFullYear();

      const season = await prisma.$transaction(async (tx) => {
        const leagueRow = leagueRowId
          ? await tx.league.update({ where: { id: leagueRowId }, data: { name: leagueData.name } })
          : await tx.league.upsert({
              where: { sleeperLeagueId },
              update: { name: leagueData.name },
              create: { name: leagueData.name, sleeperLeagueId, foundedYear: year },
            });

        return tx.season.upsert({
          where: { sleeperLeagueId },
          update: { year, status: mapSeasonStatus(leagueData.status) },
          create: {
            leagueId: leagueRow.id,
            year,
            sleeperLeagueId,
            previousSleeperLeagueId: leagueData.previous_league_id,
            status: mapSeasonStatus(leagueData.status),
            playoffTeams: leagueData.settings.playoff_teams ?? 6,
            playoffStartWeek: leagueData.settings.playoff_week_start ?? 15,
            regularSeasonWeeks: (leagueData.settings.playoff_week_start ?? 15) - 1,
            isCurrent: false,
          },
        });
      });

      leagueRowId = leagueRowId ?? season.leagueId;
      seasonIds.push(season.id);
    }

    // The last (most recent) season in the chain is the current one.
    if (leagueRowId) {
      await prisma.season.updateMany({ where: { leagueId: leagueRowId }, data: { isCurrent: false } });
      const newestSeasonId = seasonIds[seasonIds.length - 1];
      if (newestSeasonId) {
        await prisma.season.update({ where: { id: newestSeasonId }, data: { isCurrent: true } });
      }
    }

    for (const seasonId of seasonIds) {
      await syncSeason(seasonId);
    }

    return { recordsProcessed: seasonIds.length, result: { seasonsProcessed: seasonIds.length } };
  });
}

/** Re-syncs a single week's matchups for one season. */
export async function syncWeek(seasonId: string, week: number): Promise<{ seasonId: string; week: number; recordsProcessed: number }> {
  return withSyncLog(SyncType.WEEK, { seasonId, week }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);
    const statusOf = await resolveWeekStatuses(sleeperLeagueId, provider);
    const recordsProcessed = await coreSyncWeek(seasonId, sleeperLeagueId, week, provider, week >= season.playoffStartWeek, undefined, statusOf(week));
    return { recordsProcessed, result: { seasonId, week, recordsProcessed } };
  });
}

/** Re-syncs every regular-season week's transactions for one season. */
export async function syncTransactions(seasonId: string): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.TRANSACTIONS, { seasonId }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);
    const playersCatalog = await provider.getAllPlayers();
    const recordsProcessed = await coreSyncTransactions(seasonId, sleeperLeagueId, weeksFor(season), provider, playersCatalog);
    return { recordsProcessed, result: { seasonId, recordsProcessed } };
  });
}

/** Re-syncs the draft + draft picks for one season. */
export async function syncDrafts(seasonId: string): Promise<{ seasonId: string; recordsProcessed: number }> {
  return withSyncLog(SyncType.DRAFT, { seasonId }, async () => {
    const provider = getSleeperProvider();
    const season = await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    const sleeperLeagueId = resolveSleeperLeagueId(season);
    const playersCatalog = await provider.getAllPlayers();
    const recordsProcessed = await coreSyncDraft(seasonId, sleeperLeagueId, provider, playersCatalog);
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
