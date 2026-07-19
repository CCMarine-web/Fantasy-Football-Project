import { isSleeperConfigured } from "@/lib/env";
import { SleeperApiClient } from "./client";
import { MockSleeperProvider } from "./mock-provider";
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
 * Provider-agnostic surface for talking to Sleeper. `SleeperApiClient` (real
 * network calls) and `MockSleeperProvider` (fixtures, zero network) both
 * implement this so the rest of the app never needs to know which one is
 * active — call `getSleeperProvider()` and use the result.
 */
export interface SleeperProvider {
  getUser(usernameOrId: string): Promise<SleeperUser>;
  getLeague(leagueId: string): Promise<SleeperLeague>;
  getLeagueUsers(leagueId: string): Promise<SleeperUser[]>;
  getRosters(leagueId: string): Promise<SleeperRoster[]>;
  getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]>;
  getTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]>;
  getTradedPicks(leagueId: string): Promise<SleeperTradedPick[]>;
  getWinnersBracket(leagueId: string): Promise<SleeperBracketMatchup[]>;
  getLosersBracket(leagueId: string): Promise<SleeperBracketMatchup[]>;
  getDrafts(leagueId: string): Promise<SleeperDraft[]>;
  getDraft(draftId: string): Promise<SleeperDraft>;
  getDraftPicks(draftId: string): Promise<SleeperDraftPick[]>;
  getAllPlayers(): Promise<SleeperPlayersMap>;
  getLeagueHistoryChain(leagueId: string): Promise<string[]>;
}

let cachedProvider: SleeperProvider | undefined;

/**
 * Returns the active Sleeper provider: a real `SleeperApiClient` when
 * `SLEEPER_LEAGUE_ID` is configured, otherwise the deterministic
 * `MockSleeperProvider` fixtures, so the app runs with zero network calls
 * and no real league configured out of the box.
 */
export function getSleeperProvider(): SleeperProvider {
  if (!cachedProvider) {
    cachedProvider = isSleeperConfigured() ? new SleeperApiClient() : new MockSleeperProvider();
  }
  return cachedProvider;
}

/** Test/dev escape hatch: force-clear the cached provider singleton. */
export function resetSleeperProviderCache(): void {
  cachedProvider = undefined;
}
