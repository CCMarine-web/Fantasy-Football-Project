import { prisma } from "@/lib/db";
import { cached, CACHE_TAGS } from "@/server/cache";
import { getBlurbs } from "@/server/ai/blurb-cache";
import {
  buildPositionContext,
  consolidationCredit,
  valuateTrade,
  valuePlayer,
  TRADE_VALUE_CONSTANTS,
  type Lopsidedness,
  type PlayerWindow,
  type PositionContext,
  type TradeConfidence,
  type ValuedPlayer,
  type ValuedSide,
} from "@/server/stats/trade-value";

/**
 * The Trade Tribunal: what each trade was actually worth, and how one-sided it
 * turned out to be.
 *
 * The valuation itself lives in server/stats/trade-value.ts and is pure and
 * tested. This file's job is to assemble its inputs from recorded scores:
 * every player's production after the trade, and the replacement level and
 * scarcity at each position in that same window.
 *
 * The previous version compared the two sides on raw rest-of-season points,
 * which cannot settle a trade — a mid-range quarterback outscores an elite
 * tight end and is worth far less, because the next quarterback off waivers
 * also outscores that tight end.
 */

export interface TradeTribunalSide {
  managerId: string;
  managerName: string;
  /** Display strings for acquired players, e.g. "Josh Allen (QB)". */
  acquired: string[];
  /** Per-player breakdown behind this side's value. */
  players: ValuedPlayer[];
  /** Picks and FAAB, which have no market price on record. */
  unpricedAssets: string[];
  /** Position-normalised value of everything this side received. */
  value: number;
  consolidationCredit: number;
}

export interface TradeTribunalView {
  transactionId: string;
  seasonYear: number;
  week: number | null;
  sides: TradeTribunalSide[];
  /** Difference in normalised value between the two sides. */
  differential: number | null;
  /** That difference as a share of the average side's value. */
  relativeDifferential: number | null;
  lopsidedness: Lopsidedness | null;
  winnerManagerId: string | null;
  winnerName: string | null;
  confidence: TradeConfidence;
  /** Inputs the valuation could not obtain. */
  missingInputs: string[];
  /** Persisted verdict, or null when none has been generated yet. */
  verdict: string | null;
  /** Deterministic summary of the outcome — the input a verdict is written from. */
  hindsightSummary: string;
  notable: boolean;
  notes: string | null;
  /**
   * The replacement line each position was measured against, in THIS season's
   * window. Surfaced because every figure on the card is expressed as production
   * above these numbers, and a reader had no way to see what they were — "+41
   * above replacement" is unfalsifiable until you know where replacement sits.
   * Only positions involved in this trade appear.
   */
  benchmarks: PositionBenchmark[];
}

export interface PositionBenchmark {
  position: string;
  /** Points per game of the last startable player at this position. */
  replacementPpg: number;
  /** Top starters' average divided by the replacement line. */
  scarcity: number;
  /** How many players at this position the line was drawn from. */
  sampleSize: number;
}

interface AcquiredAsset {
  managerId: string;
  managerName: string;
  player: { id: string; firstName: string; lastName: string; position: string } | null;
  unpricedLabel: string | null;
}

/**
 * Every trade, valued.
 *
 * Cached: this is the most expensive read on the site — every trade's post-trade
 * player window, a replacement level and scarcity figure per position per season,
 * and a percentile for every player involved. None of it depends on who is
 * asking, and none of it changes between syncs.
 */
export const getTradeTribunal = cached(buildTradeTribunal, ["trade-tribunal"], {
  tags: [CACHE_TAGS.league, CACHE_TAGS.content],
});

async function buildTradeTribunal(): Promise<TradeTribunalView[]> {
  const trades = await prisma.transaction.findMany({
    where: { type: "TRADE" },
    include: {
      season: { select: { id: true, year: true, playoffStartWeek: true, regularSeasonWeeks: true } },
      trade: { select: { isNotable: true, notes: true } },
      assets: {
        include: {
          player: { select: { id: true, firstName: true, lastName: true, position: true } },
          fantasyTeam: {
            select: { managerId: true, manager: { select: { displayName: true } } },
          },
        },
      },
    },
    orderBy: { processedAt: "desc" },
  });

  if (trades.length === 0) return [];

  const seasonIds = [...new Set(trades.map((t) => t.season.id))];

  /*
   * Every recorded weekly score in the seasons that contain a trade, keyed by
   * player and week. This is the raw material for both a player's own window
   * and the league-wide replacement level it is measured against — the two
   * have to come from the same pool or the comparison means nothing.
   */
  const scores = await prisma.weeklyPlayerScore.findMany({
    where: {
      points: { not: null },
      roster: { fantasyTeam: { seasonId: { in: seasonIds } } },
    },
    select: {
      points: true,
      playerId: true,
      player: { select: { position: true } },
      roster: { select: { week: true, fantasyTeam: { select: { seasonId: true } } } },
    },
  });

  const teamCounts = new Map<string, number>();
  for (const seasonId of seasonIds) {
    teamCounts.set(seasonId, await prisma.fantasyTeam.count({ where: { seasonId } }));
  }

  interface ScoreRow {
    playerId: string;
    position: string;
    week: number;
    points: number;
  }
  const bySeason = new Map<string, ScoreRow[]>();
  for (const row of scores) {
    if (row.points == null) continue;
    const seasonId = row.roster.fantasyTeam.seasonId;
    const list = bySeason.get(seasonId) ?? [];
    list.push({
      playerId: row.playerId,
      position: row.player.position,
      week: row.roster.week,
      points: row.points,
    });
    bySeason.set(seasonId, list);
  }

  const cached = await getBlurbs(
    "TRADE_VERDICT",
    trades.map((t) => ({ subjectKey: t.id, inputHash: "" })),
  );
  const verdictByTransaction = new Map([...cached].map(([k, v]) => [k, v.text]));

  const views: TradeTribunalView[] = trades.map((t) => {
    const seasonRows = bySeason.get(t.season.id) ?? [];
    const fromWeek = t.week ?? 0;
    const playoffStart = t.season.playoffStartWeek ?? (t.season.regularSeasonWeeks ?? 14) + 1;
    const lastWeek = seasonRows.length > 0 ? Math.max(...seasonRows.map((r) => r.week)) : fromWeek;
    const weeksRemaining = Math.max(0, lastWeek - fromWeek + 1);

    // ── Post-trade window, per player, across the whole league ─────────────
    const windowRows = seasonRows.filter((r) => r.week >= fromWeek);
    const perPlayer = new Map<string, { position: string; points: number; games: number; playoffPoints: number; playoffGames: number }>();
    for (const row of windowRows) {
      const cur =
        perPlayer.get(row.playerId) ??
        { position: row.position, points: 0, games: 0, playoffPoints: 0, playoffGames: 0 };
      cur.points += row.points;
      cur.games += 1;
      if (row.week >= playoffStart) {
        cur.playoffPoints += row.points;
        cur.playoffGames += 1;
      }
      perPlayer.set(row.playerId, cur);
    }

    // ── Replacement level and scarcity, per position, in the same window ───
    const ppgByPosition = new Map<string, number[]>();
    for (const [, p] of perPlayer) {
      // Two games is not a rate; including one-week wonders would drag the
      // replacement line around according to who happened to be picked up.
      if (p.games < 3) continue;
      const list = ppgByPosition.get(p.position) ?? [];
      list.push(p.points / p.games);
      ppgByPosition.set(p.position, list);
    }
    const contexts = new Map<string, PositionContext>();
    for (const [position, ppgs] of ppgByPosition) {
      contexts.set(position, buildPositionContext(position, ppgs, teamCounts.get(t.season.id) ?? 10));
    }

    const percentileFor = (position: string, ppg: number): number | null => {
      const pool = ppgByPosition.get(position);
      if (!pool || pool.length < 3) return null;
      const below = pool.filter((x) => x < ppg).length;
      return Math.round((below / pool.length) * 100);
    };

    // ── Who received what ─────────────────────────────────────────────────
    const acquiredByManager = new Map<string, AcquiredAsset[]>();
    const sentByManager = new Map<string, number>();
    for (const asset of t.assets) {
      const managerId = asset.fantasyTeam.managerId;
      const managerName = asset.fantasyTeam.manager.displayName;
      if (asset.direction !== "ADD") {
        if (asset.assetType === "PLAYER") {
          sentByManager.set(managerId, (sentByManager.get(managerId) ?? 0) + 1);
        }
        continue;
      }
      const list = acquiredByManager.get(managerId) ?? [];
      if (asset.assetType === "PLAYER" && asset.player) {
        list.push({ managerId, managerName, player: asset.player, unpricedLabel: null });
      } else if (asset.assetType === "DRAFT_PICK") {
        list.push({
          managerId,
          managerName,
          player: null,
          unpricedLabel: asset.draftPickDescription ?? "a draft pick",
        });
      } else if (asset.assetType === "FAAB") {
        list.push({ managerId, managerName, player: null, unpricedLabel: `$${asset.faabAmount ?? 0} FAAB` });
      }
      acquiredByManager.set(managerId, list);
    }

    const missingInputs = new Set<string>();
    if (seasonRows.length === 0) {
      missingInputs.add(
        `no player-level scoring is on record for ${t.season.year}, so nothing in this trade can be valued`,
      );
    }

    let playerCount = 0;
    let confidentPlayers = 0;

    const valuedSides: ValuedSide[] = [...acquiredByManager.entries()].map(([managerId, assets]) => {
      const managerName = assets[0]?.managerName ?? "Unknown";
      const players: ValuedPlayer[] = [];
      const unpricedAssets: string[] = [];

      for (const asset of assets) {
        if (!asset.player) {
          if (asset.unpricedLabel) {
            unpricedAssets.push(asset.unpricedLabel);
            missingInputs.add(
              `${asset.unpricedLabel} has no market price on record, so it is named but not valued`,
            );
          }
          continue;
        }
        playerCount += 1;
        const stats = perPlayer.get(asset.player.id);
        const w: PlayerWindow = {
          playerId: asset.player.id,
          name: `${asset.player.firstName} ${asset.player.lastName}`,
          position: asset.player.position,
          gamesPlayed: stats?.games ?? 0,
          points: stats?.points ?? 0,
          playoffPoints: stats?.playoffPoints ?? 0,
          playoffGames: stats?.playoffGames ?? 0,
          weeksRemaining,
        };
        if (w.gamesPlayed >= TRADE_VALUE_CONSTANTS.CONFIDENT_GAMES) confidentPlayers += 1;
        const ppg = w.gamesPlayed > 0 ? w.points / w.gamesPlayed : 0;
        players.push(
          valuePlayer(
            w,
            contexts.get(asset.player.position),
            w.gamesPlayed > 0 ? percentileFor(asset.player.position, ppg) : null,
          ),
        );
      }

      const credit = consolidationCredit(players.length, sentByManager.get(managerId) ?? 0);
      const value = Number(
        (players.reduce((sum, p) => sum + p.value, 0) + credit).toFixed(1),
      );
      return { managerId, managerName, players, unpricedAssets, value, consolidationCredit: credit };
    });

    const valuation = valuateTrade(valuedSides, {
      missingInputs: [...missingInputs],
      playerCount,
      confidentPlayers,
    });

    const nameById = new Map(valuedSides.map((s) => [s.managerId, s.managerName]));
    const winnerName = valuation.winnerManagerId
      ? (nameById.get(valuation.winnerManagerId) ?? null)
      : null;

    /*
     * Deterministic prose summary — the input a verdict is written from, and
     * what the page shows when no verdict exists.
     *
     * The earlier wording read "X came out 93 points of value above replacement
     * ahead of Y", which puts a five-word noun phrase between the number and
     * the word it modifies and leaves a reader parsing the sentence twice. The
     * measure is now named once at the end, where it belongs.
     */
    const measuredAgainst =
      "with every player measured against what was freely available at his position";
    let hindsightSummary: string;
    if (valuation.lopsidedness == null) {
      hindsightSummary =
        valuation.confidence === "NONE"
          ? "nothing in this trade could be valued from the recorded data"
          : "this trade involved more than two managers, so it is reported rather than graded";
    } else if (valuation.lopsidedness === "EVEN_DEAL") {
      const gap = valuation.differential ?? 0;
      hindsightSummary =
        gap < 1
          ? `the two hauls came out level, ${measuredAgainst}`
          : `the two hauls finished within ${gap.toFixed(0)} points of each other, ${measuredAgainst}`;
    } else {
      const loser = valuedSides.find((s) => s.managerId !== valuation.winnerManagerId);
      hindsightSummary = `${winnerName} finished ${valuation.differential?.toFixed(0)} points ahead of ${loser?.managerName ?? "the other side"}, ${measuredAgainst}`;
    }

    return {
      transactionId: t.id,
      seasonYear: t.season.year,
      week: t.week,
      sides: valuedSides.map((s) => ({
        managerId: s.managerId,
        managerName: s.managerName,
        acquired: [
          ...s.players.map((p) => `${p.name} (${p.position})`),
          ...s.unpricedAssets,
        ],
        players: s.players,
        unpricedAssets: s.unpricedAssets,
        value: s.value,
        consolidationCredit: s.consolidationCredit,
      })),
      differential: valuation.differential,
      relativeDifferential: valuation.relativeDifferential,
      lopsidedness: valuation.lopsidedness,
      winnerManagerId: valuation.winnerManagerId,
      winnerName,
      confidence: valuation.confidence,
      missingInputs: valuation.missingInputs,
      verdict: verdictByTransaction.get(t.id) ?? null,
      hindsightSummary,
      notable: t.trade?.isNotable ?? false,
      notes: t.trade?.notes ?? null,
      /*
       * The replacement lines behind every number on this card, for the
       * positions this trade actually involved. Sorted by position so the same
       * trade always lists them in the same order.
       */
      benchmarks: [
        ...new Set(
          valuedSides.flatMap((s) => s.players.map((p) => p.position)),
        ),
      ]
        .map((position) => {
          const context = contexts.get(position);
          return context
            ? {
                position,
                replacementPpg: Number(context.replacementPpg.toFixed(1)),
                scarcity: Number(context.scarcity.toFixed(2)),
                sampleSize: context.sampleSize,
              }
            : null;
        })
        .filter((b): b is PositionBenchmark => b != null)
        .sort((a, b) => a.position.localeCompare(b.position)),
    };
  });

  // Most lopsided first; ungradeable trades last.
  const order: Record<Lopsidedness, number> = {
    HIGHWAY_ROBBERY: 0,
    FLEECED: 1,
    CLEAR_WINNER: 2,
    SLIGHT_EDGE: 3,
    EVEN_DEAL: 4,
  };
  return views.sort((a, b) => {
    const ao = a.lopsidedness ? order[a.lopsidedness] : 5;
    const bo = b.lopsidedness ? order[b.lopsidedness] : 5;
    return ao - bo || (b.differential ?? 0) - (a.differential ?? 0) || b.seasonYear - a.seasonYear;
  });
}

/**
 * Trades a reader should see by default: anything from a Clear Winner upward.
 * Even deals and slight edges are real records and stay available behind the
 * archive toggle, but a page of "these two teams both did fine" is not a
 * tribunal.
 */
export function isHeadlineTrade(view: TradeTribunalView): boolean {
  return (
    view.lopsidedness === "HIGHWAY_ROBBERY" ||
    view.lopsidedness === "FLEECED" ||
    view.lopsidedness === "CLEAR_WINNER" ||
    view.notable
  );
}
