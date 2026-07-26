/**
 * ESPN fantasy-football numeric code tables. These ids are stable across
 * seasons; anything not listed is left null rather than guessed.
 */

/** `player.defaultPositionId` -> position label used by FantasyPlayer.position. */
const POSITION_BY_ID: Record<number, string> = {
  1: "QB",
  2: "RB",
  3: "WR",
  4: "TE",
  5: "K",
  7: "P",
  9: "DT",
  10: "DE",
  11: "LB",
  12: "CB",
  13: "S",
  16: "DEF",
};

export function positionFromEspn(defaultPositionId: number | undefined): string | undefined {
  return defaultPositionId == null ? undefined : POSITION_BY_ID[defaultPositionId];
}

/**
 * `lineupSlotId` -> slot label. Bench (20), IR (21) and the unused 24 are the
 * only non-starting slots; everything else counts as a started player.
 */
const SLOT_BY_ID: Record<number, string> = {
  0: "QB",
  1: "TQB",
  2: "RB",
  3: "RB/WR",
  4: "WR",
  5: "WR/TE",
  6: "TE",
  7: "OP",
  8: "DT",
  9: "DE",
  10: "LB",
  11: "DL",
  12: "CB",
  13: "S",
  14: "DB",
  15: "DP",
  16: "DEF",
  17: "K",
  18: "P",
  19: "HC",
  20: "BN",
  21: "IR",
  23: "FLEX",
  24: "ER",
};

const NON_STARTING_SLOTS = new Set([20, 21, 24]);

export function slotFromEspn(lineupSlotId: number | undefined): string {
  if (lineupSlotId == null) return "UNKNOWN";
  return SLOT_BY_ID[lineupSlotId] ?? `SLOT_${lineupSlotId}`;
}

export function isStartingSlot(lineupSlotId: number | undefined): boolean {
  if (lineupSlotId == null) return false;
  return !NON_STARTING_SLOTS.has(lineupSlotId);
}

/** `player.proTeamId` -> NFL team abbreviation. 0 means free agent. */
const PRO_TEAM_BY_ID: Record<number, string> = {
  1: "ATL",
  2: "BUF",
  3: "CHI",
  4: "CIN",
  5: "CLE",
  6: "DAL",
  7: "DEN",
  8: "DET",
  9: "GB",
  10: "TEN",
  11: "IND",
  12: "KC",
  13: "LV",
  14: "LAR",
  15: "MIA",
  16: "MIN",
  17: "NE",
  18: "NO",
  19: "NYG",
  20: "NYJ",
  21: "PHI",
  22: "ARI",
  23: "PIT",
  24: "LAC",
  25: "SF",
  26: "SEA",
  27: "TB",
  28: "WAS",
  29: "CAR",
  30: "JAX",
  33: "BAL",
  34: "HOU",
};

export function proTeamFromEspn(proTeamId: number | undefined): string | undefined {
  if (proTeamId == null || proTeamId === 0) return undefined;
  return PRO_TEAM_BY_ID[proTeamId];
}

/** ESPN `draftSettings.type` -> the DraftType enum. */
export function draftTypeFromEspn(
  type: string | undefined,
): "SNAKE" | "AUCTION" | "LINEAR" | "OFFLINE" {
  switch (type) {
    case "AUCTION":
      return "AUCTION";
    case "LINEAR":
      return "LINEAR";
    case "OFFLINE":
      return "OFFLINE";
    case "SNAKE":
      return "SNAKE";
    default:
      // ESPN has only ever returned the four above for this league. Anything
      // new is recorded as OFFLINE (the "we don't know the ordering" value)
      // rather than being mislabelled a snake.
      return "OFFLINE";
  }
}

/**
 * ESPN playoff tiers. `WINNERS_BRACKET` is the real championship bracket;
 * both consolation ladders are placement games.
 */
export function bracketFromTier(tier: string | undefined): "WINNERS" | "CONSOLATION" | undefined {
  if (!tier || tier === "NONE") return undefined;
  return tier === "WINNERS_BRACKET" ? "WINNERS" : "CONSOLATION";
}
