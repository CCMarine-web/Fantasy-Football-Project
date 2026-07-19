import type { SleeperProvider } from "./provider";
import type {
  SleeperUser,
  SleeperLeague,
  SleeperRoster,
  SleeperMatchup,
  SleeperTransaction,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTradedPick,
  SleeperBracketMatchup,
  SleeperPlayersMap,
} from "./types";

/**
 * Deterministic, in-memory fixtures shaped like real Sleeper API responses.
 * Used whenever `SLEEPER_LEAGUE_ID` isn't configured, so the rest of the app
 * (and the sync service) can be exercised with zero network calls. This is
 * intentionally small (5 fake teams) — the full 12-manager/5-season seed
 * data lives in prisma/seed.ts, not here.
 */
export class MockSleeperProvider implements SleeperProvider {
  static readonly MOCK_LEAGUE_ID = "mock-league-000001";
  static readonly MOCK_DRAFT_ID = "mock-draft-000001";

  private readonly users: SleeperUser[] = [
    { user_id: "mock-user-1", username: "gridiron_gary", display_name: "Gary Gridiron", avatar: null, metadata: { team_name: "Gary's Gladiators" } },
    { user_id: "mock-user-2", username: "benchwarmer_bea", display_name: "Bea Bench", avatar: null, metadata: { team_name: "Bench Warmers" } },
    { user_id: "mock-user-3", username: "waiver_wendy", display_name: "Wendy Waiver", avatar: null, metadata: { team_name: "Waiver Wire Wonders" } },
    { user_id: "mock-user-4", username: "hail_mary_hank", display_name: "Hank Hail-Mary", avatar: null, metadata: { team_name: "Hail Mary Heroes" } },
    { user_id: "mock-user-5", username: "punt_pete", display_name: "Pete Punt", avatar: null, metadata: { team_name: "Punting Isn't Cool" } },
  ];

  private readonly rosters: SleeperRoster[] = this.users.map((user, index) => ({
    roster_id: index + 1,
    league_id: MockSleeperProvider.MOCK_LEAGUE_ID,
    owner_id: user.user_id,
    co_owners: null,
    players: ["mock-player-1", "mock-player-2", "mock-player-3"],
    starters: ["mock-player-1", "mock-player-2"],
    reserve: null,
    taxi: null,
    settings: {
      wins: index === 0 ? 3 : 2,
      losses: index === 0 ? 0 : 1,
      ties: 0,
      fpts: 300 + index * 10,
      fpts_decimal: 0,
      fpts_against: 280 + index * 5,
      fpts_against_decimal: 0,
      waiver_budget_used: index * 5,
    },
    metadata: null,
  }));

  private readonly players: SleeperPlayersMap = {
    "mock-player-1": { player_id: "mock-player-1", first_name: "Mock", last_name: "Quarterback", full_name: "Mock Quarterback", position: "QB", team: "MOK", status: "Active", age: 27, years_exp: 5 },
    "mock-player-2": { player_id: "mock-player-2", first_name: "Mock", last_name: "Runningback", full_name: "Mock Runningback", position: "RB", team: "MOK", status: "Active", age: 24, years_exp: 2 },
    "mock-player-3": { player_id: "mock-player-3", first_name: "Mock", last_name: "Receiver", full_name: "Mock Receiver", position: "WR", team: "MOK", status: "Active", age: 26, years_exp: 4 },
    "mock-player-4": { player_id: "mock-player-4", first_name: "Mock", last_name: "TightEnd", full_name: "Mock TightEnd", position: "TE", team: "MOK", status: "Active", age: 29, years_exp: 7 },
    "mock-player-5": { player_id: "mock-player-5", first_name: "Mock", last_name: "Kicker", full_name: "Mock Kicker", position: "K", team: "MOK", status: "Active", age: 31, years_exp: 9 },
  };

  async getUser(usernameOrId: string): Promise<SleeperUser> {
    const found = this.users.find((u) => u.user_id === usernameOrId || u.username === usernameOrId);
    if (found) return found;
    // Sleeper returns a user object even for lookups outside the mock league;
    // fabricate a stable one keyed off the input so callers get *something*.
    return { user_id: usernameOrId, username: usernameOrId, display_name: usernameOrId, avatar: null, metadata: null };
  }

  async getLeague(leagueId: string): Promise<SleeperLeague> {
    return {
      league_id: leagueId,
      name: "Mock Dynasty League",
      season: "2025",
      season_type: "regular",
      sport: "nfl",
      status: "in_season",
      total_rosters: this.rosters.length,
      previous_league_id: leagueId === MockSleeperProvider.MOCK_LEAGUE_ID ? null : null,
      draft_id: MockSleeperProvider.MOCK_DRAFT_ID,
      avatar: null,
      settings: { num_teams: this.rosters.length, playoff_teams: 4, playoff_week_start: 15, leg: 3 },
      scoring_settings: { pass_td: 4, rush_td: 6, rec_td: 6, rec: 0.5 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF", "BN", "BN", "BN"],
    };
  }

  async getLeagueUsers(_leagueId: string): Promise<SleeperUser[]> {
    return this.users;
  }

  async getRosters(_leagueId: string): Promise<SleeperRoster[]> {
    return this.rosters;
  }

  async getMatchups(_leagueId: string, week: number): Promise<SleeperMatchup[]> {
    // Pair rosters up (1v2, 3v4, ...); an odd team out gets a bye (no matchup_id partner).
    const matchups: SleeperMatchup[] = [];
    for (let i = 0; i < this.rosters.length; i += 2) {
      const matchupId = Math.floor(i / 2) + 1;
      const a = this.rosters[i];
      const b = this.rosters[i + 1];

      matchups.push(this.buildMatchup(a.roster_id, matchupId, week, 100));
      if (b) matchups.push(this.buildMatchup(b.roster_id, matchupId, week, 95));
    }
    return matchups;
  }

  private buildMatchup(rosterId: number, matchupId: number, week: number, basePoints: number): SleeperMatchup {
    const points = basePoints + rosterId + week;
    return {
      matchup_id: matchupId,
      roster_id: rosterId,
      points,
      custom_points: null,
      players: ["mock-player-1", "mock-player-2", "mock-player-3"],
      starters: ["mock-player-1", "mock-player-2"],
      players_points: { "mock-player-1": points * 0.6, "mock-player-2": points * 0.4 },
      starters_points: [points * 0.6, points * 0.4],
    };
  }

  async getTransactions(_leagueId: string, week: number): Promise<SleeperTransaction[]> {
    return [
      {
        transaction_id: `mock-txn-waiver-${week}`,
        type: "waiver",
        status: "complete",
        leg: week,
        roster_ids: [1],
        adds: { "mock-player-4": 1 },
        drops: { "mock-player-5": 1 },
        draft_picks: [],
        waiver_budget: [],
        settings: { waiver_bid: 12 },
        creator: this.users[0]?.user_id ?? null,
        created: Date.parse("2025-09-15T00:00:00Z") + week * 86_400_000,
      },
      {
        transaction_id: `mock-txn-trade-${week}`,
        type: "trade",
        status: "complete",
        leg: week,
        roster_ids: [2, 3],
        adds: { "mock-player-2": 3, "mock-player-3": 2 },
        drops: { "mock-player-2": 2, "mock-player-3": 3 },
        draft_picks: [],
        waiver_budget: [],
        settings: null,
        creator: this.users[1]?.user_id ?? null,
        created: Date.parse("2025-09-16T00:00:00Z") + week * 86_400_000,
      },
    ];
  }

  async getTradedPicks(_leagueId: string): Promise<SleeperTradedPick[]> {
    return [{ season: "2026", round: 2, roster_id: 3, previous_owner_id: 2, owner_id: 3 }];
  }

  async getWinnersBracket(_leagueId: string): Promise<SleeperBracketMatchup[]> {
    return [
      { r: 1, m: 1, t1: 1, t2: 4, w: null, l: null, t1_from: null, t2_from: null },
      { r: 1, m: 2, t1: 2, t2: 3, w: null, l: null, t1_from: null, t2_from: null },
      { r: 2, m: 3, t1: null, t2: null, w: null, l: null, t1_from: { w: 1 }, t2_from: { w: 2 }, p: 1 },
    ];
  }

  async getLosersBracket(_leagueId: string): Promise<SleeperBracketMatchup[]> {
    return [{ r: 1, m: 1, t1: 5, t2: null, w: null, l: null, t1_from: null, t2_from: null }];
  }

  async getDrafts(leagueId: string): Promise<SleeperDraft[]> {
    return [await this.getDraft(MockSleeperProvider.MOCK_DRAFT_ID, leagueId)];
  }

  async getDraft(draftId: string, leagueId: string = MockSleeperProvider.MOCK_LEAGUE_ID): Promise<SleeperDraft> {
    return {
      draft_id: draftId,
      league_id: leagueId,
      season: "2025",
      type: "snake",
      status: "complete",
      start_time: Date.parse("2025-08-24T18:00:00Z"),
      created: Date.parse("2025-08-01T00:00:00Z"),
      settings: { rounds: 2, teams: this.rosters.length },
      slot_to_roster_id: Object.fromEntries(this.rosters.map((r, i) => [String(i + 1), r.roster_id])),
      draft_order: Object.fromEntries(this.users.map((u, i) => [u.user_id, i + 1])),
    };
  }

  async getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
    const picks: SleeperDraftPick[] = [];
    const playerIds = Object.keys(this.players);
    let pickNo = 1;
    for (let round = 1; round <= 2; round += 1) {
      // Snake draft: even rounds reverse order.
      const order = round % 2 === 1 ? this.rosters : [...this.rosters].reverse();
      for (let slot = 0; slot < order.length; slot += 1) {
        const roster = order[slot];
        const player = playerIds[(pickNo - 1) % playerIds.length];
        picks.push({
          draft_id: draftId,
          pick_no: pickNo,
          round,
          draft_slot: slot + 1,
          roster_id: roster.roster_id,
          player_id: player,
          picked_by: roster.owner_id,
          is_keeper: false,
          metadata: {
            first_name: this.players[player]?.first_name ?? null,
            last_name: this.players[player]?.last_name ?? null,
            position: this.players[player]?.position ?? null,
            team: this.players[player]?.team ?? null,
          },
        });
        pickNo += 1;
      }
    }
    return picks;
  }

  async getAllPlayers(): Promise<SleeperPlayersMap> {
    return this.players;
  }

  async getLeagueHistoryChain(leagueId: string): Promise<string[]> {
    // Mock league has no previous seasons chained.
    return [leagueId];
  }
}
