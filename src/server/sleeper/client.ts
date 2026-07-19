import { getEnv } from "@/lib/env";
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
 * Thrown for any non-2xx response from the Sleeper API, instead of letting a
 * raw fetch/Response error leak out to callers.
 */
export class SleeperApiError extends Error {
  readonly status: number;
  readonly endpoint: string;

  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "SleeperApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

// ---------------------------------------------------------------------------
// In-memory response cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  expiresAt: number;
  value: unknown;
}

/** TTL presets, in milliseconds. */
const TTL = {
  /** Live-ish data: rosters, matchups, transactions. */
  SHORT: 30_000,
  /** Rarely-changing data: league metadata, drafts, brackets. */
  MEDIUM: 5 * 60_000,
  /** Sleeper explicitly asks callers to fetch /players/nfl at most once/day. */
  LONG: 24 * 60 * 60_000,
} as const;

// ---------------------------------------------------------------------------
// Tiny concurrency-capped request queue
// ---------------------------------------------------------------------------

class RequestSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }
}

export interface SleeperApiClientOptions {
  baseUrl?: string;
  /** Max in-flight requests at once. Defaults to 5. */
  maxConcurrent?: number;
}

/**
 * Thin typed wrapper around the unauthenticated Sleeper REST API. Not meant
 * to be used directly by app code — go through `getSleeperProvider()` in
 * `./provider` so real vs. mock data is an implementation detail.
 */
export class SleeperApiClient {
  private readonly baseUrl: string;
  private readonly semaphore: RequestSemaphore;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options: SleeperApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? getEnv().SLEEPER_API_BASE_URL;
    this.semaphore = new RequestSemaphore(options.maxConcurrent ?? 5);
  }

  // -- users ------------------------------------------------------------

  async getUser(usernameOrId: string): Promise<SleeperUser> {
    return this.request<SleeperUser>(`/user/${usernameOrId}`, TTL.MEDIUM);
  }

  // -- league -------------------------------------------------------------

  async getLeague(leagueId: string): Promise<SleeperLeague> {
    return this.request<SleeperLeague>(`/league/${leagueId}`, TTL.MEDIUM);
  }

  async getLeagueUsers(leagueId: string): Promise<SleeperUser[]> {
    return this.request<SleeperUser[]>(`/league/${leagueId}/users`, TTL.SHORT);
  }

  async getRosters(leagueId: string): Promise<SleeperRoster[]> {
    return this.request<SleeperRoster[]>(`/league/${leagueId}/rosters`, TTL.SHORT);
  }

  async getMatchups(leagueId: string, week: number): Promise<SleeperMatchup[]> {
    return this.request<SleeperMatchup[]>(`/league/${leagueId}/matchups/${week}`, TTL.SHORT);
  }

  async getTransactions(leagueId: string, week: number): Promise<SleeperTransaction[]> {
    return this.request<SleeperTransaction[]>(`/league/${leagueId}/transactions/${week}`, TTL.SHORT);
  }

  async getTradedPicks(leagueId: string): Promise<SleeperTradedPick[]> {
    return this.request<SleeperTradedPick[]>(`/league/${leagueId}/traded_picks`, TTL.MEDIUM);
  }

  async getWinnersBracket(leagueId: string): Promise<SleeperBracketMatchup[]> {
    return this.request<SleeperBracketMatchup[]>(`/league/${leagueId}/winners_bracket`, TTL.MEDIUM);
  }

  async getLosersBracket(leagueId: string): Promise<SleeperBracketMatchup[]> {
    return this.request<SleeperBracketMatchup[]>(`/league/${leagueId}/losers_bracket`, TTL.MEDIUM);
  }

  // -- drafts -------------------------------------------------------------

  async getDrafts(leagueId: string): Promise<SleeperDraft[]> {
    return this.request<SleeperDraft[]>(`/league/${leagueId}/drafts`, TTL.MEDIUM);
  }

  async getDraft(draftId: string): Promise<SleeperDraft> {
    return this.request<SleeperDraft>(`/draft/${draftId}`, TTL.MEDIUM);
  }

  async getDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
    return this.request<SleeperDraftPick[]>(`/draft/${draftId}/picks`, TTL.MEDIUM);
  }

  // -- players --------------------------------------------------------------

  /**
   * Full NFL player metadata dump (~5MB+). Sleeper's docs say to fetch this
   * AT MOST once per day, hence the 24h cache TTL — every call within a day
   * reuses the same in-memory response.
   */
  async getAllPlayers(): Promise<SleeperPlayersMap> {
    return this.request<SleeperPlayersMap>(`/players/nfl`, TTL.LONG);
  }

  // -- composite helpers ----------------------------------------------------

  /**
   * Walks `previous_league_id` backwards starting from `leagueId`, returning
   * every league_id in the chain (current season first, oldest last). Useful
   * for backfilling multiple historical seasons for one franchise, since
   * Sleeper models "the same league across years" as a linked list rather
   * than a single stable id.
   */
  async getLeagueHistoryChain(leagueId: string): Promise<string[]> {
    const chain: string[] = [];
    let currentId: string | null = leagueId;
    const seen = new Set<string>();

    // Sleeper uses the sentinel string "0" (not null) to mean "no earlier
    // season" for `previous_league_id` — treat it the same as null/empty,
    // otherwise the walk 404s trying to fetch league "0".
    while (currentId && currentId !== "0" && !seen.has(currentId)) {
      seen.add(currentId);
      chain.push(currentId);
      const league: SleeperLeague = await this.getLeague(currentId);
      currentId = league.previous_league_id;
    }

    return chain;
  }

  // -- internals --------------------------------------------------------------

  private async request<T>(path: string, ttlMs: number): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const cached = this.cache.get(url);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const value = await this.semaphore.run(() => this.fetchJson<T>(url, path));
    this.cache.set(url, { expiresAt: now + ttlMs, value });
    return value;
  }

  private async fetchJson<T>(url: string, endpoint: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, { headers: { accept: "application/json" } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SleeperApiError(`Network error calling Sleeper API: ${message}`, 0, endpoint);
    }

    if (!response.ok) {
      throw new SleeperApiError(
        `Sleeper API request failed with status ${response.status} ${response.statusText}`,
        response.status,
        endpoint
      );
    }

    try {
      return (await response.json()) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SleeperApiError(`Failed to parse Sleeper API response as JSON: ${message}`, response.status, endpoint);
    }
  }
}
