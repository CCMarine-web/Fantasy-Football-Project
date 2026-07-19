// Plain input types for the historical statistics engine. No I/O, no Prisma — these are the
// shapes the (separately built) repository layer must map its DB rows into before calling
// the functions in this package.

// A single game from one manager's point of view.
export interface GameResult {
  week: number;
  season: number;
  isPlayoff: boolean;
  pointsFor: number;
  pointsAgainst: number;
  opponentId: string;
  result: "W" | "L" | "T";
}

// One manager's roster output for a single week, used for lineup-efficiency stats.
export interface WeeklyLineup {
  week: number;
  season: number;
  starterPoints: number; // sum of starters' actual points
  optimalPoints: number; // sum of the best-possible starting lineup from the full roster that week
  benchPoints: number;
}

// A manager's placement for a completed season, used for career finish stats.
export interface SeasonFinish {
  season: number;
  regularSeasonRank: number;
  finalRank: number; // after playoffs; ties/no-playoffs can equal regularSeasonRank
  madePlayoffs: boolean;
  isChampion: boolean;
  isRunnerUp: boolean;
}

// One team's raw score in a given week, used as input to all-play calculations.
export interface WeeklyScore {
  teamId: string;
  points: number;
}

// The result of comparing one team against the rest of the league for a single week.
export interface AllPlayRecord {
  teamId: string;
  week: number;
  season: number;
  wins: number;
  losses: number;
  ties: number;
}

// Aggregated all-play totals across some number of weeks.
export interface AllPlayTotals {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  games: number;
}

// A single chronological head-to-head game between two named teams, used for Elo updates.
export interface EloGame {
  week: number;
  season?: number;
  teamAId: string;
  teamBId: string;
  teamAScore: number;
  teamBScore: number;
}

// Final Elo rating for one team after processing a sequence of EloGame entries.
export interface EloRating {
  teamId: string;
  rating: number;
}

// Options controlling a career-stats query: restrict to regular season, playoffs, or both (default).
export type SeasonSegment = "all" | "regularSeason" | "playoffs";
