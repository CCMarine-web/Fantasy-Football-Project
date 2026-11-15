/**
 * ONE colour system for every chart on the site.
 *
 * Team colours: a 10-colour palette chosen to stay distinguishable for the
 * common colour-vision deficiencies (based on Okabe-Ito and Tol's "bright"
 * and "muted" sets) and to read on the dark theme. A manager keeps the same
 * colour on every chart: colours are assigned by the manager's position in the
 * league's manager list sorted by id, not by rank or by the order a chart
 * happens to draw them.
 *
 * Position colours are the fantasy-standard ones: QB red, RB green, WR blue,
 * TE orange, K and DEF grey.
 */

export const TEAM_PALETTE = [
  "#56B4E9", // sky blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#F0E442", // yellow
  "#CC79A7", // reddish purple
  "#D55E00", // vermillion
  "#88CCEE", // light cyan
  "#AA4499", // purple
  "#44AA99", // teal
  "#DDCC77", // sand
] as const;

/** Stable colour per manager id, given every manager id in the league. */
export function teamColorMap(managerIds: string[]): Map<string, string> {
  const sorted = [...new Set(managerIds)].sort();
  return new Map(sorted.map((id, i) => [id, TEAM_PALETTE[i % TEAM_PALETTE.length]]));
}

export const POSITION_COLORS: Record<string, string> = {
  QB: "#E5484D",
  RB: "#30A46C",
  WR: "#3E8EE8",
  TE: "#F76B15",
  K: "#8B8D98",
  DEF: "#8B8D98",
  DST: "#8B8D98",
  FLEX: "#8B8D98",
};

export function positionColor(position: string | null | undefined): string {
  return POSITION_COLORS[(position ?? "").toUpperCase()] ?? "#8B8D98";
}

/** Win/loss colours that pass contrast on the dark theme. */
export const RESULT_COLORS = { win: "#3DD68C", loss: "#FF6369", neutral: "#8B8D98", accent: "var(--primary)" } as const;

/** A sequential scale 0-100 -> colour (low = red, mid = grey, high = green), colour-blind safe via lightness. */
export function heatColor(value0to100: number | null | undefined): string {
  if (value0to100 == null || Number.isNaN(value0to100)) return "transparent";
  const v = Math.max(0, Math.min(100, value0to100)) / 100;
  // Diverging blue (good) / orange (bad) — distinguishable for red-green CVD.
  const hue = v >= 0.5 ? 220 : 30;
  const strength = Math.abs(v - 0.5) * 2; // 0 at the middle, 1 at the ends
  return `hsl(${hue} ${Math.round(25 + strength * 55)}% ${Math.round(24 + strength * 18)}%)`;
}

export const TOOLTIP_STYLE = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--popover-foreground)",
  fontSize: 12,
} as const;

export const AXIS_PROPS = {
  stroke: "var(--muted-foreground)",
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;
