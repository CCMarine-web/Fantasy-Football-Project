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
}

export interface MatchupCardData {
  matchupId: string;
  season: number;
  week: number;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINAL";
  isPlayoff?: boolean;
  roundName?: string | null;
  teams: [MatchupCardTeam, MatchupCardTeam];
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
  playoffProbability?: number | null;
  recentForm?: ("W" | "L" | "T")[];
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
