import type { ManagerDef, ManagerKey, Position } from "./types";

export const LEAGUE_NAME = "Gridiron Mayhem Fantasy Football League";
export const LEAGUE_SHORT_NAME = "GMFFL";
export const FOUNDED_YEAR = 2021;
export const SEASON_YEARS = [2021, 2022, 2023, 2024, 2025] as const;
export const CURRENT_SEASON_YEAR = 2025;
export const CURRENT_SEASON_WEEKS_PLAYED = 8;
export const REGULAR_SEASON_WEEKS = 14;
export const PLAYOFF_TEAMS = 6;
export const PLAYOFF_START_WEEK = 15;
export const TEAM_COUNT = 12;

/**
 * The order of this array fixes each manager's schedule-generator index
 * (0-11). This matters: the round-robin circle method (see schedule.ts)
 * deterministically pairs index 0 with index 7 in round index 4 (week 5)
 * every season, which is how Marcus (0) vs Sofia (7) is guaranteed to meet
 * every regular season, and index 6 with index 8 (Kevin vs Jordan) lands in
 * that same round. Do not reorder without re-deriving schedule.ts's comments.
 */
export const MANAGERS: ManagerDef[] = [
  {
    key: "marcus",
    displayName: "Marcus Cole",
    baseTeamName: "Cole's Casket Company",
    bio: "Overdrafts running backs like they're going extinct, then closes the lid on your Sunday with a merciless Monday-night stream.",
    noRoast: false,
    baseStrength: 7,
  },
  {
    key: "priya",
    displayName: "Priya Natarajan",
    baseTeamName: "Natarajan's Nightmares",
    bio: "Spreadsheet-brained GM who has a tiebreak scenario memorized before Thursday Night Football kicks off.",
    noRoast: false,
    baseStrength: 2,
  },
  {
    key: "deshawn",
    displayName: "Deshawn Griggs",
    baseTeamName: "Griggs & Bear It",
    bio: "Plays every season like a chess match and every trade like a heist film.",
    noRoast: false,
    baseStrength: 5,
  },
  {
    key: "emily",
    displayName: "Emily Vasquez",
    baseTeamName: "Vasquez Vandals",
    bio: "Drafts on vibes, wins on volume, insists analytics are 'a whole mood, not a strategy.'",
    noRoast: true,
    baseStrength: 1,
  },
  {
    key: "tyler",
    displayName: "Tyler Brandt",
    baseTeamName: "Brandt Total Chaos",
    bio: "Rebrands his team more often than he sets his lineup, which is a real problem given how often he forgets to set his lineup.",
    noRoast: false,
    baseStrength: 0,
  },
  {
    key: "aisha",
    displayName: "Aisha Thompson",
    baseTeamName: "Thompson's Twin Towers",
    bio: "Builds around two workhorse studs every year and dares the league to find a third starter that matters.",
    noRoast: false,
    baseStrength: 3,
  },
  {
    key: "kevin",
    displayName: "Kevin O'Malley",
    baseTeamName: "O'Malley's Alley Cats",
    bio: "The league's lovable perennial rebuilder — it is always 'a transition year' for the Alley Cats, every single year.",
    noRoast: false,
    baseStrength: -9,
  },
  {
    key: "sofia",
    displayName: "Sofia Reyes",
    baseTeamName: "Reyes of Sunshine",
    bio: "Commissioner, dynasty owner, and the reason the league constitution now has a clause about gloating.",
    noRoast: false,
    baseStrength: 9,
  },
  {
    key: "jordan",
    displayName: "Jordan Whitfield",
    baseTeamName: "Whitfield's Wildcats",
    bio: "Perpetually one bye week away from a winning record, forever blaming the bye week.",
    noRoast: false,
    baseStrength: -2,
  },
  {
    key: "brianna",
    displayName: "Brianna Lockhart",
    baseTeamName: "Lockhart & Load",
    bio: "Waiver-wire sharpshooter who has never met a Tuesday-night FAAB bid she didn't like.",
    noRoast: false,
    baseStrength: 1,
  },
  {
    key: "devon",
    displayName: "Devon Park",
    baseTeamName: "Park Place Ballers",
    bio: "Plays it safe, starts his studs, and somehow still finds a way to lose the shootout.",
    noRoast: false,
    baseStrength: -1,
  },
  {
    key: "natalie",
    displayName: "Natalie Huang",
    baseTeamName: "Huang's House of Pain",
    bio: "Trash-talks in the group chat like it's a competitive sport separate from the actual league.",
    noRoast: false,
    baseStrength: 2,
  },
];

export const MANAGER_INDEX: Record<ManagerKey, number> = Object.fromEntries(
  MANAGERS.map((m, i) => [m.key, i]),
) as Record<ManagerKey, number>;

/** Tyler Brandt's team name changed twice; everyone else is stable. */
export function teamNameForSeason(key: ManagerKey, year: number): string {
  if (key === "tyler") {
    if (year === 2021) return "Brandt Name Only";
    if (year === 2022 || year === 2023) return "The Brandt Ambassador";
    return "Brandt Total Chaos";
  }
  return MANAGERS.find((m) => m.key === key)!.baseTeamName;
}

export const SENSITIVE_TOPICS = [
  "medical diagnoses",
  "divorce/relationship breakups",
  "job loss/finances",
];

// ---------------------------------------------------------------------------
// Player pool
// ---------------------------------------------------------------------------

export const NFL_TEAMS = [
  "ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE",
  "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC",
  "LAC", "LAR", "LV", "MIA", "MIN", "NE", "NO", "NYG",
  "NYJ", "PHI", "PIT", "SEA", "SF", "TB", "TEN", "WAS",
] as const;

export const NFL_CITY_NAMES: Record<string, string> = {
  ARI: "Arizona", ATL: "Atlanta", BAL: "Baltimore", BUF: "Buffalo",
  CAR: "Carolina", CHI: "Chicago", CIN: "Cincinnati", CLE: "Cleveland",
  DAL: "Dallas", DEN: "Denver", DET: "Detroit", GB: "Green Bay",
  HOU: "Houston", IND: "Indianapolis", JAX: "Jacksonville", KC: "Kansas City",
  LAC: "LA Chargers", LAR: "LA Rams", LV: "Las Vegas", MIA: "Miami",
  MIN: "Minnesota", NE: "New England", NO: "New Orleans", NYG: "NY Giants",
  NYJ: "NY Jets", PHI: "Philadelphia", PIT: "Pittsburgh", SEA: "Seattle",
  SF: "San Francisco", TB: "Tampa Bay", TEN: "Tennessee", WAS: "Washington",
};

export const FIRST_NAMES = [
  "Trevon", "Marquis", "Dashiell", "Kellen", "Bryce", "Jaylen", "Cordell",
  "Trent", "Deion", "Marcell", "Rasheed", "Colton", "Andre", "Miles",
  "Xavier", "Braylon", "Damarion", "Corbin", "Tyree", "Jaquan", "Grayson",
  "Nehemiah", "Wyatt", "Kaden", "Amari", "Denzel", "Reggie", "Malachi",
  "Zaire", "Preston", "Isaiah", "Cooper", "Deshaun", "Elijah", "Tobias",
  "Quinton", "Landry", "Emmitt", "Julian", "Sterling", "Roman", "Karsen",
  "Jabari", "Cassius", "Donovan",
] as const;

export const LAST_NAMES = [
  "Ashby", "Delgado", "Whitmore", "Castellano", "Rourke", "Beauchamp",
  "Kirkland", "Sanborn", "Okafor", "Duval", "Prentice", "Larkspur",
  "Marchetti", "Beaumont", "Tillery", "Nakamura", "Fontenot", "Radcliffe",
  "Bellamy", "Escobar", "Sutter", "Kingsley", "Vaccaro", "Holloway",
  "Winslow", "Dunmore", "Castellanos", "Merriweather", "Boudreaux",
  "Hargrove", "Lancaster", "Pemberton", "Wexford", "Callaway", "Strickland",
  "Osei", "Blakemore", "Trudeau", "Higginbotham", "Delacroix", "Kessler",
  "Vantassel", "Marsh", "Odumbe", "Talbot", "Redwine", "Isaacson",
  "Guerrero", "Brantley",
] as const;

/**
 * How many FantasyPlayer rows to generate per position (196 total).
 *
 * Each season's draft needs QB2/RB5/WR5/TE2/K1/DEF1 per team x 12 teams
 * with no duplicate player within that season, i.e. a per-season minimum of
 * QB24/RB60/WR60/TE24/K12/DEF12 (see DRAFT_ROUND_POSITIONS). These counts
 * sit right at (or a little above) that floor, so within one season's draft
 * every pick is a distinct player, while the pool is still reused
 * (re-drafted) across all 5 seasons.
 */
export const POSITION_COUNTS: Record<Position, number> = {
  QB: 24,
  RB: 60,
  WR: 60,
  TE: 24,
  K: 12,
  DEF: 16,
};

// ---------------------------------------------------------------------------
// Roster construction
// ---------------------------------------------------------------------------

/**
 * Position drafted in each of the 16 rounds, identical for every team every
 * season (real drafts vary more, but this keeps roster-slot bookkeeping
 * simple and deterministic). Produces exactly QB2/RB5/WR5/TE2/K1/DEF1 = 16.
 */
export const DRAFT_ROUND_POSITIONS: Position[] = [
  "RB", "WR", "RB", "WR", "QB", "TE", "RB", "WR",
  "RB", "WR", "QB", "RB", "WR", "TE", "K", "DEF",
];

export interface RoundSlotDef {
  isStarter: boolean;
  lineupSlot: string;
}

/** Maps draft round (1-indexed) -> the lineup slot that pick fills all season. */
export const ROUND_SLOT_MAP: Record<number, RoundSlotDef> = {
  1: { isStarter: true, lineupSlot: "RB" }, // RB1
  2: { isStarter: true, lineupSlot: "WR" }, // WR1
  3: { isStarter: true, lineupSlot: "RB" }, // RB2
  4: { isStarter: true, lineupSlot: "WR" }, // WR2
  5: { isStarter: true, lineupSlot: "QB" },
  6: { isStarter: true, lineupSlot: "TE" },
  7: { isStarter: true, lineupSlot: "FLEX" }, // RB3 as flex
  8: { isStarter: false, lineupSlot: "BN" },
  9: { isStarter: false, lineupSlot: "BN" },
  10: { isStarter: false, lineupSlot: "BN" },
  11: { isStarter: false, lineupSlot: "BN" },
  12: { isStarter: false, lineupSlot: "BN" },
  13: { isStarter: false, lineupSlot: "BN" },
  14: { isStarter: false, lineupSlot: "BN" },
  15: { isStarter: true, lineupSlot: "K" },
  16: { isStarter: true, lineupSlot: "DEF" },
};

/** Fraction of a team's weekly total assigned to each starter round-slot. */
export const STARTER_WEIGHT_BY_ROUND: Record<number, number> = {
  1: 0.15, // RB1
  2: 0.13, // WR1
  3: 0.13, // RB2
  4: 0.11, // WR2
  5: 0.17, // QB
  6: 0.09, // TE
  7: 0.12, // FLEX (RB3)
  15: 0.06, // K
  16: 0.04, // DEF
};

/** Mean/stdDev for independently-simulated bench player weekly points. */
export const BENCH_POINTS_BY_POSITION: Record<Position, { mean: number; stdDev: number }> = {
  QB: { mean: 15, stdDev: 6 },
  RB: { mean: 9, stdDev: 5 },
  WR: { mean: 8, stdDev: 5 },
  TE: { mean: 6, stdDev: 3.5 },
  K: { mean: 7, stdDev: 2.5 },
  DEF: { mean: 6, stdDev: 3 },
};

export const TEAM_WEEKLY_MEAN = 110;
export const TEAM_WEEKLY_STDDEV = 18;
export const FAAB_BUDGET = 100;
