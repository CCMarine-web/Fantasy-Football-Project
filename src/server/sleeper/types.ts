/**
 * Raw response shapes for the Sleeper public API (https://docs.sleeper.com).
 *
 * These interfaces intentionally model only the fields we are confident
 * Sleeper returns and that this app has a use for. Sleeper's API is
 * unversioned and undocumented in places, so treat any field not listed
 * here as "unknown, ignore" rather than assuming it doesn't exist.
 */

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
  /** Only present on league-scoped user lookups (GET /league/{id}/users). */
  is_owner?: boolean | null;
  /** League-specific metadata such as team name/avatar overrides. */
  metadata: SleeperUserMetadata | null;
}

export interface SleeperUserMetadata {
  team_name?: string | null;
  avatar?: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// League
// ---------------------------------------------------------------------------

export type SleeperLeagueStatus = "pre_draft" | "drafting" | "in_season" | "complete" | string;

export interface SleeperLeagueSettings {
  num_teams: number;
  playoff_teams?: number | null;
  playoff_week_start?: number | null;
  leg?: number | null;
  [key: string]: unknown;
}

export interface SleeperScoringSettings {
  [statKey: string]: number | undefined;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  season_type: string;
  sport: string;
  status: SleeperLeagueStatus;
  total_rosters: number;
  previous_league_id: string | null;
  draft_id: string | null;
  avatar: string | null;
  settings: SleeperLeagueSettings;
  scoring_settings: SleeperScoringSettings;
  roster_positions: string[];
}

// ---------------------------------------------------------------------------
// Rosters
// ---------------------------------------------------------------------------

export interface SleeperRosterSettings {
  wins: number;
  losses: number;
  ties: number;
  fpts: number;
  fpts_decimal?: number | null;
  fpts_against?: number | null;
  fpts_against_decimal?: number | null;
  waiver_budget_used?: number | null;
  [key: string]: unknown;
}

export interface SleeperRoster {
  roster_id: number;
  league_id: string;
  owner_id: string | null;
  co_owners: string[] | null;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  settings: SleeperRosterSettings;
  metadata: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Matchups
// ---------------------------------------------------------------------------

export interface SleeperMatchup {
  matchup_id: number | null;
  roster_id: number;
  points: number | null;
  custom_points: number | null;
  players: string[] | null;
  starters: string[] | null;
  players_points: Record<string, number> | null;
  starters_points: number[] | null;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export type SleeperTransactionType = "waiver" | "free_agent" | "trade" | "commissioner" | string;
export type SleeperTransactionStatus = "complete" | "pending" | "failed" | string;

export interface SleeperTransactionSettings {
  waiver_bid?: number | null;
  [key: string]: unknown;
}

export interface SleeperDraftPickAsset {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

export interface SleeperTransaction {
  transaction_id: string;
  type: SleeperTransactionType;
  status: SleeperTransactionStatus;
  leg: number;
  roster_ids: number[];
  /** player_id -> roster_id that added the player in this transaction. */
  adds: Record<string, number> | null;
  /** player_id -> roster_id that dropped the player in this transaction. */
  drops: Record<string, number> | null;
  draft_picks: SleeperDraftPickAsset[];
  waiver_budget: Array<{ sender: number; receiver: number; amount: number }>;
  settings: SleeperTransactionSettings | null;
  creator: string | null;
  created: number;
}

// NOTE: `adds` / `drops` above are keyed by player_id (string) with the
// receiving/dropping roster_id (number) as the value, e.g.
// `{ "421": 3 }` = player 421 was added/dropped by roster 3.

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type SleeperDraftType = "snake" | "linear" | "auction" | string;
export type SleeperDraftStatus = "pre_draft" | "drafting" | "paused" | "complete" | string;

export interface SleeperDraftSettings {
  rounds: number;
  teams: number;
  [key: string]: unknown;
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  type: SleeperDraftType;
  status: SleeperDraftStatus;
  start_time: number | null;
  created: number;
  settings: SleeperDraftSettings;
  /** slot (as string) -> roster/user id, mapping draft order. */
  slot_to_roster_id: Record<string, number> | null;
  draft_order: Record<string, number> | null;
}

export interface SleeperDraftPickMetadata {
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
  [key: string]: unknown;
}

export interface SleeperDraftPick {
  draft_id: string;
  pick_no: number;
  round: number;
  draft_slot: number;
  roster_id: number;
  player_id: string;
  picked_by: string | null;
  is_keeper: boolean | null;
  metadata: SleeperDraftPickMetadata | null;
}

export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

// ---------------------------------------------------------------------------
// Playoff brackets
// ---------------------------------------------------------------------------

export interface SleeperBracketMatchup {
  r: number;
  m: number;
  t1: number | null;
  t2: number | null;
  w: number | null;
  l: number | null;
  /** Which upstream bracket-matchup slot t1/t2 came from, e.g. {w: 1} meaning "winner of match 1". */
  t1_from: Record<string, number> | null;
  t2_from: Record<string, number> | null;
  p?: number | null;
}

// ---------------------------------------------------------------------------
// Players (full NFL dump)
// ---------------------------------------------------------------------------

export interface SleeperPlayer {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  position: string | null;
  team: string | null;
  status: string | null;
  age: number | null;
  years_exp: number | null;
  [key: string]: unknown;
}

/** GET /players/nfl returns an object keyed by player_id, not an array. */
export type SleeperPlayersMap = Record<string, SleeperPlayer>;
