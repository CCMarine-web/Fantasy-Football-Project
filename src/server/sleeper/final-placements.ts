import type { SleeperBracketMatchup } from "./types";

/**
 * Derives a complete 1..N final placement for a Sleeper season from its two
 * playoff brackets.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The sync only ever recorded `finalRank` for the champion, runner-up and
 * third place, so seven of ten teams a season had no finish at all and the
 * manager pages showed a dash. Sleeper does publish the rest — it just spreads
 * it across two endpoints.
 *
 * ── How Sleeper encodes placements ────────────────────────────────────────
 * Every bracket matchup that decides a position carries a `p`: the winner
 * finishes `p` and the loser `p + 1`. In the WINNERS bracket those numbers are
 * absolute (p=1 is the title game, p=3 the third-place game, p=5 the fifth).
 * In the LOSERS bracket they restart from 1, so they have to be offset past
 * the teams that made the playoffs: with six playoff teams, losers-bracket
 * p=1 decides 7th and 8th, and p=3 decides 9th and 10th.
 *
 * Verified against 2023-2025 for this league: winners p ∈ {1,3,5} and losers
 * p ∈ {1,3} together assign all ten rosters exactly one distinct place.
 *
 * ── What it refuses to do ─────────────────────────────────────────────────
 * Unfinished matchups (`w` null, as in a season that hasn't been played) yield
 * no placement rather than a guess, and a bracket that would assign the same
 * place twice is rejected wholesale — a partial, self-consistent result is
 * useful, a silently wrong one is not.
 */

export interface FinalPlacements {
  /** Sleeper roster id -> final position, 1 = champion. */
  byRosterId: Map<number, number>;
  /** Roster ids that appeared anywhere in the winners bracket. */
  playoffRosterIds: Set<number>;
  /** Populated when the brackets could not be resolved into distinct places. */
  problem?: string;
}

export function deriveFinalPlacements(
  winnersBracket: SleeperBracketMatchup[],
  losersBracket: SleeperBracketMatchup[],
  playoffTeamCount: number,
): FinalPlacements {
  const byRosterId = new Map<number, number>();
  const playoffRosterIds = new Set<number>();

  for (const m of winnersBracket) {
    if (m.t1 != null) playoffRosterIds.add(m.t1);
    if (m.t2 != null) playoffRosterIds.add(m.t2);
  }

  const assign = (
    rosterId: number | null | undefined,
    place: number,
    taken: Map<number, number>,
  ) => {
    if (rosterId == null) return;
    taken.set(rosterId, place);
  };

  const placed = new Map<number, number>();

  for (const m of winnersBracket) {
    if (m.p == null || m.w == null || m.l == null) continue;
    assign(m.w, m.p, placed);
    assign(m.l, m.p + 1, placed);
  }

  // Losers-bracket positions are relative; shift them past the playoff field.
  const offset = playoffTeamCount > 0 ? playoffTeamCount : 0;
  for (const m of losersBracket) {
    if (m.p == null || m.w == null || m.l == null) continue;
    assign(m.w, offset + m.p, placed);
    assign(m.l, offset + m.p + 1, placed);
  }

  // Reject a bracket that hands the same position to two rosters — that would
  // mean the offset assumption does not hold for this league's settings.
  const seen = new Map<number, number>();
  for (const [rosterId, place] of placed) {
    const previous = seen.get(place);
    if (previous != null) {
      return {
        byRosterId: new Map(),
        playoffRosterIds,
        problem: `position ${place} was assigned to both roster ${previous} and roster ${rosterId}`,
      };
    }
    seen.set(place, rosterId);
  }

  for (const [rosterId, place] of placed) byRosterId.set(rosterId, place);
  return { byRosterId, playoffRosterIds };
}
