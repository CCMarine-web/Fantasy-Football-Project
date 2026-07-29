/**
 * Shared display formatting.
 *
 * `ordinal` exists because the site was building ordinals by concatenating
 * "th": a 61st percentile read "61th percentile" and a 23rd pick read "23th".
 * Every ordinal on the site goes through here so the exceptions (1st, 2nd, 3rd,
 * and the 11-13 trap) are handled once.
 */

/** "th" | "st" | "nd" | "rd" for a whole number. */
export function ordinalSuffix(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  switch (abs % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** "1st", "2nd", "3rd", "11th", "21st", "61st". */
export function ordinal(n: number): string {
  const whole = Math.trunc(n);
  return `${whole}${ordinalSuffix(whole)}`;
}

/**
 * How positions are named in public copy.
 *
 * The platforms store a team defence as "DEF", which the site was printing
 * verbatim beside players' names — so a report card read "1 DEF" where every
 * other line named a football position. A defence is a Team D/ST and is called
 * that everywhere a reader can see it.
 */
const POSITION_LABEL: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  K: "K",
  DEF: "Team D/ST",
  DST: "Team D/ST",
  "D/ST": "Team D/ST",
  DL: "Team D/ST",
  UNK: "Unknown",
};

export function positionLabel(position: string | null | undefined): string {
  if (!position) return "Unknown";
  return POSITION_LABEL[position.toUpperCase()] ?? position;
}
