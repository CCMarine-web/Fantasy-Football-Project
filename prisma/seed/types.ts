// Shared internal types for the seed simulation. Kept separate from the
// generated Prisma types because these describe in-memory intermediate
// simulation state, not persisted rows.

export type ManagerKey =
  | "marcus"
  | "priya"
  | "deshawn"
  | "emily"
  | "tyler"
  | "aisha"
  | "kevin"
  | "sofia"
  | "jordan"
  | "brianna"
  | "devon"
  | "natalie";

export interface ManagerDef {
  key: ManagerKey;
  displayName: string;
  /** Team name used when no TeamNameHistory override applies for a season. */
  baseTeamName: string;
  bio: string;
  noRoast: boolean;
  /** Base weekly-score offset applied on top of the league mean of 110. */
  baseStrength: number;
}

export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DEF";

export interface PlayerSeed {
  firstName: string;
  lastName: string;
  position: Position;
  nflTeam: string;
}

/** One resolved roster slot for a team, derived from that team's draft. */
export interface RosterSlotAssignment {
  playerId: string;
  position: Position;
  lineupSlot: string;
  isStarter: boolean;
}

/** Running accumulator of a team's regular-season performance. */
export interface StandingsAccumulator {
  fantasyTeamId: string;
  managerKey: ManagerKey;
  teamIndex: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  currentStreakType: "W" | "L" | "T" | null;
  currentStreakCount: number;
}

export interface WeekMatchupResult {
  week: number;
  teamAIndex: number;
  teamBIndex: number;
  scoreA: number;
  scoreB: number;
  isPlayoff: boolean;
  roundName?: string;
  playoffRound?: number;
}

export interface SeasonManagerState {
  managerKey: ManagerKey;
  fantasyTeamId: string;
  /** 16 drafted players for the season, in draft-round order (index 0 = round 1). */
  draftedPlayerIds: string[];
}

export interface FinalStandingRow {
  fantasyTeamId: string;
  managerKey: ManagerKey;
  teamIndex: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  regularSeasonRank: number;
}
