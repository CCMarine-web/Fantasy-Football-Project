import { prisma } from "@/lib/db";

/**
 * A recap describes a game that has been played. These guards are the single
 * definition of "played", applied everywhere a recap can be generated or
 * stored, so writing about an unplayed week is refused at the point of
 * storage rather than relying on every caller to have filtered correctly.
 *
 * The bug this exists for: unplayed weeks were once synced as FINAL 0-0
 * games, and the weekly pipeline recapped week 17 four times before week 4
 * had kicked off.
 */

export interface MatchupForGuard {
  status: string;
  teams: { score: number | null }[];
}

/** FINAL, exactly two sides, and both scores on record. */
export function isPlayedMatchup(m: MatchupForGuard): boolean {
  return m.status === "FINAL" && m.teams.length === 2 && m.teams.every((t) => t.score != null);
}

export class UnplayedMatchupError extends Error {
  constructor(matchupId: string | null, why: string) {
    super(`Refusing to write a recap for matchup ${matchupId ?? "(none)"}: ${why}`);
    this.name = "UnplayedMatchupError";
  }
}

/** Throws unless the matchup exists and has been played. */
export async function assertMatchupPlayed(matchupId: string | null | undefined): Promise<void> {
  if (!matchupId) throw new UnplayedMatchupError(null, "a recap must name the matchup it describes");
  const matchup = await prisma.matchup.findUnique({
    where: { id: matchupId },
    select: { status: true, teams: { select: { score: true } } },
  });
  if (!matchup) throw new UnplayedMatchupError(matchupId, "no such matchup");
  if (!isPlayedMatchup(matchup)) {
    throw new UnplayedMatchupError(matchupId, `the game is ${matchup.status}, not a finished result`);
  }
}
