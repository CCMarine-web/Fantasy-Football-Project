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
 * Rounds a set of shares to whole percentages that still sum to exactly 100.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 * The draft report cards published five weights — 0.2985, 0.2388, 0.1791,
 * 0.1493, 0.1194 — which sum to 1.0000 exactly. Rounded one at a time with
 * Math.round they print 30, 24, 18, 15, 12: ninety-nine percent. Every graded
 * season on the site had a methodology panel that did not add up, and a reader
 * checking the arithmetic was right to conclude the model was not the one being
 * described.
 *
 * ── The method ────────────────────────────────────────────────────────────
 * Largest remainder (Hare quota): floor everything, then hand the leftover
 * points to the entries with the biggest discarded fractions. The result is the
 * closest whole-number set to the true shares whose total is exactly `total`,
 * and it is stable — equal remainders break toward the earlier entry, so the
 * same input always prints the same table.
 *
 * Shares are expected to sum to ~1. If they do not (a caller passing an
 * unnormalised set), they are normalised first, because a panel claiming to show
 * the weights actually used must show them as proportions of what was used.
 */
export function distributePercentages(shares: number[], total = 100): number[] {
  if (shares.length === 0) return [];
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum <= 0) return shares.map(() => 0);

  const exact = shares.map((s) => (s / sum) * total);
  const floors = exact.map((v) => Math.floor(v));
  let remaining = total - floors.reduce((a, b) => a + b, 0);

  // Biggest discarded fraction first; ties go to the earlier entry so the output
  // is deterministic rather than dependent on sort implementation.
  const order = exact
    .map((v, index) => ({ index, remainder: v - Math.floor(v) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  const out = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    out[index] += 1;
    remaining -= 1;
  }
  return out;
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
