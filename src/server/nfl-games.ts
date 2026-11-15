import { cached } from "@/server/cache";

/**
 * NFL kickoff windows for one week — TNF, Sunday early/late, SNF, MNF — from
 * nflverse's public schedule (github.com/nflverse/nfldata, free, no key).
 *
 * The file covers every season (~2 MB, over the Next fetch cache's limit), so
 * it is fetched uncached and only the small per-week result is cached.
 */

export const WINDOW_ORDER = ["TNF", "Fri", "Sat", "Sun early", "Sun late", "SNF", "MNF"] as const;
export type GameWindow = (typeof WINDOW_ORDER)[number];

const SOURCE = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

/** nflverse abbreviations differ from Sleeper's for a few teams. */
const TO_NFLVERSE: Record<string, string> = { LAR: "LA", JAC: "JAX", WSH: "WAS", OAK: "LV", SD: "LAC", STL: "LA" };

export function windowFor(weekday: string, gametime: string): GameWindow {
  const [h] = gametime.split(":").map(Number);
  switch (weekday) {
    case "Thursday":
      return "TNF";
    case "Friday":
      return "Fri";
    case "Saturday":
      return "Sat";
    case "Monday":
      return "MNF";
    default:
      return h >= 19 ? "SNF" : h >= 15 ? "Sun late" : "Sun early";
  }
}

async function loadWeek(season: number, week: number): Promise<Record<string, GameWindow>> {
  const res = await fetch(SOURCE, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return {};
  const text = await res.text();
  const lines = text.split("\n");
  const header = lines[0].split(",");
  const col = (name: string) => header.indexOf(name);
  const [iSeason, iType, iWeek, iDay, iTime, iAway, iHome] = ["season", "game_type", "week", "weekday", "gametime", "away_team", "home_team"].map(col);
  const out: Record<string, GameWindow> = {};
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    if (Number(c[iSeason]) !== season || c[iType] !== "REG" || Number(c[iWeek]) !== week) continue;
    const w = windowFor(c[iDay], c[iTime]);
    out[c[iAway]] = w;
    out[c[iHome]] = w;
  }
  return out;
}

/** team abbreviation (Sleeper style) -> kickoff window, for one week. */
export async function getWeekWindows(season: number, week: number): Promise<(team: string | null | undefined) => GameWindow | null> {
  const map = await cached(() => loadWeek(season, week), ["nfl-windows", String(season), String(week)], { revalidate: 7 * 86_400 })();
  return (team) => {
    if (!team) return null;
    const t = team.toUpperCase();
    return map[TO_NFLVERSE[t] ?? t] ?? null;
  };
}
