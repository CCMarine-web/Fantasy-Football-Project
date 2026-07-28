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
 * Every bracket matchup that decides a position carries a `p`. In the WINNERS
 * bracket the numbers are absolute and mean what they look like: p=1 is the
 * title game, p=3 the third-place game, p=5 the fifth. The winner finishes `p`
 * and the loser `p + 1`. Checked against all 21 winners-bracket games of
 * 2023-2025: `w` is the higher scorer in every one.
 *
 * The LOSERS bracket runs the other way, and this is the part that is easy to
 * get wrong. It is a toilet bowl: you "advance" by LOSING, and its `w` field
 * marks the team that advances, not the team that scored more. All 12
 * losers-bracket games of 2023-2025 have `w` as the LOWER scorer — 12 out of
 * 12, against 21 out of 21 the other way in the winners bracket, so this is
 * the encoding and not a data glitch.
 *
 * It follows that losers p=1 is the toilet-bowl FINAL and decides last place,
 * not seventh: its `w` — the team that lost its way through the whole bracket —
 * finishes bottom. So the losers placements count up from the bottom of the
 * table rather than down from the playoff field:
 *
 *     place(w) = totalTeams - (p - 1)      place(l) = totalTeams - p
 *
 * With ten teams: p=1 puts `w` 10th and `l` 9th; p=3 puts `w` 8th and `l` 7th.
 *
 * Reading it the intuitive way instead (winner of losers p=1 takes 7th) put
 * 2024 Ethan Jones, 7-7, last and 2024 Logan Javier, 1-13, eighth. The
 * corrected order tracks the regular-season table closely, as a consolation
 * bracket seeded from that table should.
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
  totalTeamCount: number,
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

  // Losers-bracket positions count up from the bottom of the table: its `w`
  // advanced by losing, so the `p=1` "winner" is last, not seventh.
  for (const m of losersBracket) {
    if (m.p == null || m.w == null || m.l == null) continue;
    assign(m.w, totalTeamCount - (m.p - 1), placed);
    assign(m.l, totalTeamCount - m.p, placed);
  }

  // A consolation place that lands inside the playoff field means the team
  // counts disagree with the brackets; better to refuse than to overwrite a
  // playoff finish with a toilet-bowl one.
  for (const m of losersBracket) {
    if (m.p == null || m.w == null || m.l == null) continue;
    if (totalTeamCount - m.p <= playoffTeamCount) {
      return {
        byRosterId: new Map(),
        playoffRosterIds,
        problem: `losers-bracket p=${m.p} would place a team at ${totalTeamCount - m.p}, inside the ${playoffTeamCount}-team playoff field`,
      };
    }
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
