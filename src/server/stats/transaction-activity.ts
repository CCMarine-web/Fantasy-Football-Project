/**
 * TRANSACTION ACTIVITY — who works the wire, and whether it paid.
 *
 *   Activity grid   managers × weeks, the number of completed moves each
 *                   manager was party to that week, split by type.
 *
 *   Pickup stint    For one waiver or free-agent add, the run of weeks the
 *                   player then spent on the acquiring roster, and the points
 *                   he scored there AS A STARTER. A pickup who sat on the bench
 *                   all season did nothing for anyone.
 *
 * Pure; the repository feeds it.
 */

export type MoveType = "WAIVER" | "FREE_AGENT" | "TRADE" | "COMMISSIONER";

export interface ActivityMove {
  week: number | null;
  type: MoveType;
  /** Every manager party to the move (both sides of a trade). */
  managerIds: string[];
}

export interface ActivityCell {
  total: number;
  byType: Partial<Record<MoveType, number>>;
}

/**
 * Moves per manager per week, keyed `${managerId}|${week}`. A trade counts once
 * for each manager in it; a move with no week, or a manager listed twice on one
 * move, counts once.
 */
export function activityGrid(moves: ActivityMove[]): Map<string, ActivityCell> {
  const grid = new Map<string, ActivityCell>();
  for (const m of moves) {
    if (m.week == null) continue;
    for (const id of new Set(m.managerIds)) {
      const key = `${id}|${m.week}`;
      const cell = grid.get(key) ?? { total: 0, byType: {} };
      cell.total += 1;
      cell.byType[m.type] = (cell.byType[m.type] ?? 0) + 1;
      grid.set(key, cell);
    }
  }
  return grid;
}

export interface StintRow {
  week: number;
  isStarter: boolean;
  points: number | null;
}

export interface PickupStint {
  /** First week on the acquiring roster, or null if he never showed up there. */
  startWeek: number | null;
  /** Last consecutive week on that roster. */
  endWeek: number | null;
  weeksOnRoster: number;
  /** Weeks he was in the starting lineup with a recorded score. */
  startedWeeks: number;
  /** Points scored in those starts. */
  starterPoints: number;
}

/**
 * The stint that follows an add made in `acquiredWeek`.
 *
 * `teamWeeks` are the weeks the acquiring team has a roster snapshot for;
 * `playerRows` are the player's rows on that team's rosters. The stint starts
 * at the first snapshot week ≥ the add in which he appears — the add week
 * itself if the claim cleared before kickoff, otherwise the week after — and
 * ends at the first snapshot week he is missing from: that is when he left.
 * If he is on neither the add-week nor the next snapshot, he was cut before
 * playing a down for the team and the stint is empty.
 */
export function pickupStint(acquiredWeek: number, teamWeeks: number[], playerRows: StintRow[]): PickupStint {
  const rowByWeek = new Map(playerRows.map((r) => [r.week, r]));
  const weeks = [...new Set(teamWeeks)].filter((w) => w >= acquiredWeek).sort((a, b) => a - b);
  const stint: PickupStint = { startWeek: null, endWeek: null, weeksOnRoster: 0, startedWeeks: 0, starterPoints: 0 };
  for (let i = 0; i < weeks.length; i++) {
    const row = rowByWeek.get(weeks[i]);
    if (!row) {
      if (stint.startWeek != null) break;
      // Allow one snapshot of grace for an add processed after that week's games.
      if (i >= 1) break;
      continue;
    }
    if (stint.startWeek == null) stint.startWeek = weeks[i];
    stint.endWeek = weeks[i];
    stint.weeksOnRoster += 1;
    if (row.isStarter && row.points != null) {
      stint.startedWeeks += 1;
      stint.starterPoints += row.points;
    }
  }
  stint.starterPoints = Number(stint.starterPoints.toFixed(2));
  return stint;
}
