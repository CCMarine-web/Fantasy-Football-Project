import { getEnv } from "@/lib/env";

/**
 * Minimal ESPN read-API client for archived fantasy-football seasons.
 *
 * ── Endpoint choice ────────────────────────────────────────────────────────
 * Completed seasons live behind `leagueHistory`, which takes `seasonId` and
 * returns an ARRAY with one element. The current-season path
 * (`/seasons/{year}/segments/0/leagues/{id}`) returns an object and 404s for
 * the league's older years, so `leagueHistory` is the only endpoint that
 * covers 2017-2022 uniformly. Verified against league 501874: 2018-2022 answer
 * on both paths, 2017 only on `leagueHistory`.
 *
 * ── Credentials ───────────────────────────────────────────────────────────
 * The league is private, so both browser cookies are required. They are read
 * from the environment and never logged: `redactSecrets()` scrubs them from
 * every string this module hands back, because ESPN echoes the caller's SWID
 * inside ordinary response bodies (it doubles as that member's id).
 */

const READ_HOST = "https://lm-api-reads.fantasy.espn.com";

export class EspnAuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "EspnAuthError";
  }
}

/** ESPN has no data for this season, even though it may list it as a prior season. */
export class EspnSeasonUnavailableError extends Error {
  constructor(readonly year: number) {
    super(`ESPN returned HTTP 404 for ${year} — no archived data is served for this season.`);
    this.name = "EspnSeasonUnavailableError";
  }
}

/**
 * Removes both cookie values from a string. Applied to every response body and
 * error message before it can reach a log, a report file or the database.
 * Never bypass this: an ESPN member id IS a SWID, so response bodies routinely
 * contain the signed-in user's credential verbatim.
 */
export function redactSecrets(text: string): string {
  const env = getEnv();
  let out = text;
  for (const secret of [env.ESPN_SWID, env.ESPN_S2]) {
    const value = secret.trim();
    if (value.length >= 8) out = out.split(value).join("<redacted>");
  }
  return out;
}

export function hasCredentials(): boolean {
  const env = getEnv();
  return env.ESPN_SWID.trim().length > 0 && env.ESPN_S2.trim().length > 0;
}

function cookieHeader(): string {
  const env = getEnv();
  return `SWID=${env.ESPN_SWID.trim()}; espn_s2=${env.ESPN_S2.trim()}`;
}

export interface EspnMember {
  id: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export interface EspnTeam {
  id: number;
  abbrev?: string;
  name?: string;
  location?: string;
  nickname?: string;
  logo?: string;
  owners?: string[];
  primaryOwner?: string;
  playoffSeed?: number;
  rankCalculatedFinal?: number;
  points?: number;
  record?: {
    overall?: {
      wins?: number;
      losses?: number;
      ties?: number;
      pointsFor?: number;
      pointsAgainst?: number;
      streakLength?: number;
      streakType?: string;
    };
  };
  roster?: { entries?: EspnRosterEntry[] };
}

export interface EspnPlayer {
  id: number;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  defaultPositionId?: number;
  proTeamId?: number;
}

export interface EspnRosterEntry {
  playerId: number;
  lineupSlotId: number;
  playerPoolEntry?: { player?: EspnPlayer };
}

export interface EspnMatchupSide {
  teamId: number;
  totalPoints?: number;
  pointsByScoringPeriod?: Record<string, number>;
}

export interface EspnMatchup {
  id: number;
  matchupPeriodId: number;
  playoffTierType?: string;
  winner?: string;
  home?: EspnMatchupSide;
  away?: EspnMatchupSide;
}

export interface EspnDraftPick {
  id: number;
  roundId: number;
  roundPickNumber: number;
  overallPickNumber: number;
  teamId: number;
  playerId: number;
  keeper?: boolean;
  bidAmount?: number;
  lineupSlotId?: number;
}

export interface EspnSeasonData {
  seasonId?: number;
  teams?: EspnTeam[];
  members?: EspnMember[];
  schedule?: EspnMatchup[];
  transactions?: unknown[];
  draftDetail?: { drafted?: boolean; inProgress?: boolean; picks?: EspnDraftPick[] };
  status?: {
    finalScoringPeriod?: number;
    currentMatchupPeriod?: number;
    previousSeasons?: number[];
  };
  settings?: {
    name?: string;
    size?: number;
    draftSettings?: { type?: string; date?: number; auctionBudget?: number };
    scheduleSettings?: { matchupPeriodCount?: number; playoffTeamCount?: number };
  };
}

/**
 * ESPN rate-limits bursts of history requests, so failed reads are retried
 * with backoff. Auth failures and 404s are terminal and returned immediately —
 * retrying either just wastes time.
 */
async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  year: number,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 401 || res.status === 403) {
        throw new EspnAuthError(
          res.status,
          `ESPN rejected the stored credentials for ${year} (HTTP ${res.status}).`,
        );
      }
      if (res.status === 404) throw new EspnSeasonUnavailableError(year);
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(`ESPN ${year}: HTTP ${res.status}`);
        if (attempt < attempts) {
          await new Promise((r) => setTimeout(r, 1000 * attempt * attempt));
          continue;
        }
      }
      return res;
    } catch (err) {
      if (err instanceof EspnAuthError || err instanceof EspnSeasonUnavailableError) throw err;
      lastError = err;
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1000 * attempt * attempt));
    }
  }
  throw new Error(
    redactSecrets(lastError instanceof Error ? lastError.message : String(lastError)),
  );
}

export async function fetchSeason(
  leagueId: string,
  year: number,
  views: string[],
  extraParams: Record<string, string> = {},
): Promise<EspnSeasonData> {
  const params = new URLSearchParams({ seasonId: String(year), ...extraParams });
  for (const view of views) params.append("view", view);
  const url = `${READ_HOST}/apis/v3/games/ffl/leagueHistory/${leagueId}?${params}`;

  const res = await fetchWithRetry(
    url,
    { Cookie: cookieHeader(), Accept: "application/json" },
    year,
  );
  if (!res.ok) {
    const body = redactSecrets(await res.text().catch(() => ""));
    throw new Error(`ESPN ${year} request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }

  const raw = redactSecrets(await res.text());
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ESPN ${year} returned a non-JSON body (${raw.slice(0, 120)})`);
  }
  const data = (Array.isArray(parsed) ? parsed[0] : parsed) as EspnSeasonData | undefined;
  if (!data) throw new EspnSeasonUnavailableError(year);
  return data;
}

/**
 * Looks up players by ESPN id for a given season.
 *
 * Needed because the archived league views only describe players who were on a
 * roster when the season ended — roughly a quarter of each draft class had been
 * dropped by then and arrives as a bare id. This endpoint fills those in, so a
 * draft pick records who was actually taken instead of a null player.
 *
 * Unlike the league views this one lives under `/seasons/{year}/players` and
 * takes the id list in an `X-Fantasy-Filter` header.
 */
export async function fetchPlayers(year: number, playerIds: number[]): Promise<EspnPlayer[]> {
  const found: EspnPlayer[] = [];
  const BATCH = 200;
  for (let index = 0; index < playerIds.length; index += BATCH) {
    const batch = playerIds.slice(index, index + BATCH);
    const url = `${READ_HOST}/apis/v3/games/ffl/seasons/${year}/players?scoringPeriodId=0&view=players_wl`;
    const res = await fetchWithRetry(
      url,
      {
        Cookie: cookieHeader(),
        Accept: "application/json",
        "X-Fantasy-Filter": JSON.stringify({ filterIds: { value: batch } }),
      },
      year,
    );
    if (!res.ok) continue;
    const raw = redactSecrets(await res.text());
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) found.push(...(parsed as EspnPlayer[]));
    } catch {
      // A malformed batch costs those players their names, not the import.
    }
  }
  return found;
}

/**
 * NOTE ON REDACTION AND MEMBER IDS
 *
 * An ESPN member id IS that member's SWID, so the signed-in user's own id
 * arrives from `redactSecrets` as the literal string "<redacted>". This is
 * deliberate and safe:
 *
 *  - Redaction is applied uniformly to the whole body, so `members[].id` and
 *    the matching `teams[].owners[]` / `teams[].primaryOwner` are rewritten
 *    identically and still join correctly.
 *  - Exactly one member per season can be the signed-in user, so "<redacted>"
 *    stays unique within a season and never merges two people.
 *  - No ESPN member id is persisted anywhere. Owner identity is resolved from
 *    member NAMES (see owners.ts) and stored as a Manager relation.
 */
