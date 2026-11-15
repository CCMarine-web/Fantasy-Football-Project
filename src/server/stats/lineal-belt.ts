import { countsForSeries, seriesResult } from "./head-to-head";

/**
 * The lineal belt: a title that changes hands on the field, every week.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * The first-ever champion picks the belt up at the final whistle of the
 * league's first title game. From then on, whoever beats the holder head-to-
 * head takes it. Only games that count for the head-to-head series count here
 * (`countsForSeries`): regular season and championship-bracket games. The
 * consolation bracket decides nothing, so a holder who has been eliminated from
 * the title race keeps the belt until a real game takes it off them.
 *
 * A week the holder does not play (a playoff bye, elimination, the offseason,
 * a game that could not be verified) is not a defense and does not cost them
 * the belt. A game level on points is decided the way the series decides it —
 * the platform's own tiebreak stands — and a genuine tie is a successful
 * defense: you have to beat the champ to be the champ.
 *
 * Pure: no I/O. The repository maps verified game rows into `BeltGame`.
 */

export interface BeltGame {
  year: number;
  week: number;
  isPlayoff: boolean;
  bracket?: string | null;
  managerId: string;
  managerName: string;
  opponentManagerId: string;
  opponentManagerName: string;
  score: number;
  opponentScore: number;
  /** The platform's decision, used only when the scores are level. */
  isWinner: boolean | null;
}

/** Who holds the belt first, and from which game. */
export interface BeltStart {
  managerId: string;
  managerName: string;
  year: number;
  week: number;
}

export interface BeltReign {
  holderId: string;
  holderName: string;
  startYear: number;
  startWeek: number;
  /** Null for the opening reign, which began with the first title game. */
  wonFromId: string | null;
  wonFromName: string | null;
  /** The score of the game that won the belt (holder's points first). */
  wonScore: [number, number] | null;
  /** Null while the reign is current. */
  endYear: number | null;
  endWeek: number | null;
  lostToId: string | null;
  lostToName: string | null;
  lostScore: [number, number] | null;
  /** Games played as holder and not lost (wins and ties). */
  defenses: number;
  isCurrent: boolean;
}

export interface BeltManagerSummary {
  managerId: string;
  managerName: string;
  reigns: number;
  defenses: number;
}

export interface LinealBelt {
  start: BeltStart;
  /** Oldest first. */
  reigns: BeltReign[];
  current: BeltReign;
  /** Every reign with the most defenses — more than one when tied. */
  longest: BeltReign[];
  byManager: BeltManagerSummary[];
}

const order = (year: number, week: number) => year * 100 + week;

export function computeLinealBelt(games: BeltGame[], start: BeltStart): LinealBelt {
  const startKey = order(start.year, start.week);
  // Weeks after the crowning game, oldest first; only the holder's row matters.
  const byWeek = new Map<number, BeltGame[]>();
  for (const g of games) {
    if (!countsForSeries(g)) continue;
    const key = order(g.year, g.week);
    if (key <= startKey) continue;
    const list = byWeek.get(key) ?? [];
    list.push(g);
    byWeek.set(key, list);
  }
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  const reigns: BeltReign[] = [];
  let current: BeltReign = {
    holderId: start.managerId,
    holderName: start.managerName,
    startYear: start.year,
    startWeek: start.week,
    wonFromId: null,
    wonFromName: null,
    wonScore: null,
    endYear: null,
    endWeek: null,
    lostToId: null,
    lostToName: null,
    lostScore: null,
    defenses: 0,
    isCurrent: true,
  };

  for (const key of weeks) {
    const game = byWeek.get(key)!.find((g) => g.managerId === current.holderId);
    if (!game) continue; // Idle week: nothing defended, nothing lost.
    const result = seriesResult({
      pointsFor: game.score,
      pointsAgainst: game.opponentScore,
      result: game.isWinner === true ? "W" : game.isWinner === false ? "L" : "T",
    });
    if (result !== "L") {
      current.defenses += 1;
      continue;
    }
    reigns.push({
      ...current,
      endYear: game.year,
      endWeek: game.week,
      lostToId: game.opponentManagerId,
      lostToName: game.opponentManagerName,
      lostScore: [game.score, game.opponentScore],
      isCurrent: false,
    });
    current = {
      holderId: game.opponentManagerId,
      holderName: game.opponentManagerName,
      startYear: game.year,
      startWeek: game.week,
      wonFromId: game.managerId,
      wonFromName: game.managerName,
      wonScore: [game.opponentScore, game.score],
      endYear: null,
      endWeek: null,
      lostToId: null,
      lostToName: null,
      lostScore: null,
      defenses: 0,
      isCurrent: true,
    };
  }
  reigns.push(current);

  const most = Math.max(...reigns.map((r) => r.defenses));
  const longest = reigns.filter((r) => r.defenses === most);

  const summary = new Map<string, BeltManagerSummary>();
  for (const r of reigns) {
    const s = summary.get(r.holderId) ?? { managerId: r.holderId, managerName: r.holderName, reigns: 0, defenses: 0 };
    s.reigns += 1;
    s.defenses += r.defenses;
    s.managerName = r.holderName;
    summary.set(r.holderId, s);
  }
  const byManager = [...summary.values()].sort(
    (a, b) => b.defenses - a.defenses || b.reigns - a.reigns || a.managerName.localeCompare(b.managerName),
  );

  return { start, reigns, current, longest, byManager };
}

/** The rule, stated once, for the page. */
export const LINEAL_BELT_RULE =
  "The belt started with the league's first champion at the final whistle of the first title game. " +
  "After that it changes hands whenever someone beats the holder head-to-head, in a regular-season or " +
  "championship-bracket game. Consolation games don't count, a week the holder doesn't play costs them " +
  "nothing, and a tie is a successful defense. A defense is any game played as holder and not lost.";
