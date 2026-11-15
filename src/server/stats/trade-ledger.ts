/**
 * TRADE LEDGER — the Tribunal's numbers, rearranged three ways.
 *
 *   Value over time   For one trade, each side's running value week by week
 *                     after the deal. Built by re-running the SAME valuation
 *                     (valuePlayer, same replacement line, same scarcity, same
 *                     playoff bonus) on the player's window cut off at each
 *                     week, so the last point is, by construction, the value on
 *                     the card. It is not a separate model that might drift.
 *
 *   Manager ledger    Per manager, across every two-sided trade: value
 *                     received minus value given (the other side's haul).
 *
 *   Partner grid      Per pair of managers: how many trades, and the row
 *                     manager's net value across them.
 *
 * Pure and deterministic; the repository feeds it.
 */

import { valuePlayer, type PositionContext } from "./trade-value";

// ── Value over time ─────────────────────────────────────────────────────────

/** One acquired player's scored weeks inside the trade's window (already filtered by the trade-week rule). */
export interface TimelinePlayer {
  playerId: string;
  name: string;
  position: string;
  weekly: { week: number; points: number }[];
}

export interface TimelineSide {
  managerId: string;
  players: TimelinePlayer[];
  consolidationCredit: number;
}

export interface TimelinePoint {
  week: number;
  /** Running value per manager id, after this week. */
  values: Record<string, number>;
}

/**
 * Running value for each side at each of `weeks`.
 *
 * At week w a player's window is every scored week up to and including w; the
 * value is valuePlayer() on that truncated window against the season's final
 * replacement line, so a line can dip (a bad week pulls the per-game rate
 * toward replacement) as well as climb. The consolidation credit is a property
 * of the deal, not of any week, so it is banked from the first point.
 */
export function buildValueTimeline(input: {
  sides: TimelineSide[];
  weeks: number[];
  contexts: Map<string, PositionContext>;
  playoffStart: number;
  weeksRemaining: number;
}): TimelinePoint[] {
  const { sides, weeks, contexts, playoffStart, weeksRemaining } = input;
  return weeks.map((week) => {
    const values: Record<string, number> = {};
    for (const side of sides) {
      let sum = 0;
      for (const p of side.players) {
        let points = 0;
        let games = 0;
        let playoffPoints = 0;
        let playoffGames = 0;
        for (const row of p.weekly) {
          if (row.week > week) continue;
          points += row.points;
          games += 1;
          if (row.week >= playoffStart) {
            playoffPoints += row.points;
            playoffGames += 1;
          }
        }
        sum += valuePlayer(
          {
            playerId: p.playerId,
            name: p.name,
            position: p.position,
            gamesPlayed: games,
            points,
            playoffPoints,
            playoffGames,
            weeksRemaining,
          },
          contexts.get(p.position),
          null,
        ).value;
      }
      // Same rounding as the side total in the repository.
      values[side.managerId] = Number((sum + side.consolidationCredit).toFixed(1));
    }
    return { week, values };
  });
}

// ── Manager ledger and partner grid ─────────────────────────────────────────

export interface LedgerTrade {
  sides: { managerId: string; value: number }[];
}

export interface LedgerEntry {
  managerId: string;
  trades: number;
  received: number;
  given: number;
  /** received − given. */
  net: number;
}

/**
 * Net trade value per manager. Only two-sided trades count: in a three-way
 * deal "what you gave" is not one other side's haul, and the league has never
 * made one, so they are skipped rather than guessed at.
 */
export function tradeLedger(trades: LedgerTrade[]): LedgerEntry[] {
  const byManager = new Map<string, LedgerEntry>();
  for (const t of trades) {
    if (t.sides.length !== 2) continue;
    const [a, b] = t.sides;
    for (const [me, them] of [
      [a, b],
      [b, a],
    ] as const) {
      const e = byManager.get(me.managerId) ?? { managerId: me.managerId, trades: 0, received: 0, given: 0, net: 0 };
      e.trades += 1;
      e.received += me.value;
      e.given += them.value;
      byManager.set(me.managerId, e);
    }
  }
  return [...byManager.values()]
    .map((e) => ({
      ...e,
      received: Number(e.received.toFixed(1)),
      given: Number(e.given.toFixed(1)),
      net: Number((e.received - e.given).toFixed(1)),
    }))
    .sort((x, y) => y.net - x.net || x.managerId.localeCompare(y.managerId));
}

export interface PartnerCell {
  trades: number;
  /** The ROW manager's net value across their two-sided trades with the column manager. */
  net: number;
}

/**
 * Trades between every pair, keyed `${rowId}|${colId}`. Symmetric in count,
 * antisymmetric in net.
 */
export function tradePartnerGrid(trades: LedgerTrade[]): Map<string, PartnerCell> {
  const grid = new Map<string, PartnerCell>();
  const bump = (row: string, col: string, net: number) => {
    const key = `${row}|${col}`;
    const cell = grid.get(key) ?? { trades: 0, net: 0 };
    cell.trades += 1;
    cell.net = Number((cell.net + net).toFixed(1));
    grid.set(key, cell);
  };
  for (const t of trades) {
    const ids = [...new Set(t.sides.map((s) => s.managerId))];
    const twoSided = t.sides.length === 2;
    for (const row of ids) {
      for (const col of ids) {
        if (row === col) continue;
        const net = twoSided
          ? (t.sides.find((s) => s.managerId === row)?.value ?? 0) - (t.sides.find((s) => s.managerId === col)?.value ?? 0)
          : 0;
        bump(row, col, net);
      }
    }
  }
  return grid;
}
