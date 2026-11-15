/**
 * Plain view-model types shared by presentational components. These are
 * deliberately decoupled from Prisma's generated types — pages/repositories
 * map DB rows into these shapes, so components never import `@/generated/prisma`.
 */

export interface MatchupCardTeam {
  fantasyTeamId: string;
  teamName: string;
  managerName: string;
  avatarUrl?: string | null;
  record?: string;
  score?: number | null;
  projectedScore?: number | null;
  isWinner?: boolean | null;
  /** In-progress points from Sleeper (display only, never stored). */
  liveScore?: number | null;
}

export interface MatchupCardData {
  matchupId: string;
  season: number;
  week: number;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINAL";
  isPlayoff?: boolean;
  roundName?: string | null;
  teams: [MatchupCardTeam, MatchupCardTeam];
  /** When live points were fetched (ISO); set only with live scores. */
  liveAsOf?: string;
}

export interface StandingsRow {
  fantasyTeamId: string;
  managerId: string;
  rank: number;
  teamName: string;
  managerName: string;
  avatarUrl?: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  allPlayRecord?: string;
  expectedWins?: number;
  scheduleLuck?: number;
  /** Luck label from the sample-aware z-score (stats/luck-wins.ts). */
  luckLabel?: string | null;
  playoffProbability?: number | null;
  /** Last five regular-season results, oldest first, with week and opponent. */
  recentForm?: { result: "W" | "L" | "T"; week: number; opponentName: string; score: number; opponentScore: number }[];
  /** Which tiebreaker placed this team below an identical record above it. */
  tiebreak?: string | null;
  /** Monte Carlo odds over the remaining schedule (season in progress only). */
  odds?: { playoffPct: number; byePct: number; titlePct: number; lastPct: number; clinched: boolean; eliminated: boolean } | null;
}

export interface ManagerSummary {
  managerId: string;
  displayName: string;
  avatarUrl?: string | null;
  currentTeamName: string;
  championships: number;
  finalsAppearances: number;
  careerWins: number;
  careerLosses: number;
  careerTies: number;
  winningPercentage: number;
}

export interface TransactionListItem {
  id: string;
  seasonYear: number;
  week: number | null;
  type: "WAIVER" | "FREE_AGENT" | "TRADE" | "COMMISSIONER";
  processedAt: Date;
  faabSpent?: number | null;
  summary: string;
}
