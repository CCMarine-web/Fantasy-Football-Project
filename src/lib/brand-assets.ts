import manifest from "./brand-assets.manifest.json";

/**
 * Every piece of commissioned artwork the site has a place for, by filename.
 *
 * Drop a file named after its slot (`hero-home.png`, `card-blake-mire.png`) in
 * /asset-inbox and run `npm run assets:ingest`: it is cropped, resized and
 * optimised to the slot's spec, written to /public/brand, and recorded in
 * brand-assets.manifest.json. Components ask for a slot by key and render a
 * placeholder until the art exists, so nothing waits on the artwork and nothing
 * else has to be edited when it arrives. ASSETS.md is the human-facing shot
 * list (prompts, art direction) for the same slots.
 */

export type BrandSlotGroup = "page" | "header" | "award" | "championship" | "shame" | "manager";

export interface BrandSlot {
  key: string;
  group: BrandSlotGroup;
  /** Output size in pixels. The source is cropped to this aspect ratio. */
  width: number;
  height: number;
  /** Cut-out art (PNG with alpha) rather than a full-bleed picture. */
  transparent: boolean;
  /** P1 changes how the site feels; P2 is polish. */
  priority: "P1" | "P2";
  /** Where it appears. */
  placement: string;
}

const header = (section: string, title: string, priority: "P1" | "P2" = "P2"): BrandSlot => ({
  key: `header-${section}`,
  group: "header",
  width: 1536,
  height: 512,
  transparent: false,
  priority,
  placement: `${title} page, banner above the page title`,
});

const award = (key: string, title: string): BrandSlot => ({
  key: `award-${key}`,
  group: "award",
  width: 512,
  height: 512,
  transparent: true,
  priority: "P1",
  placement: `${title} badge on the weekly awards (Matchups hub and weekly issues)`,
});

export const BRAND_SLOTS: BrandSlot[] = [
  { key: "hero-home", group: "page", width: 1536, height: 640, transparent: false, priority: "P1", placement: "Homepage, behind the masthead (a strip above it on phones)" },
  { key: "empty-trap", group: "page", width: 512, height: 512, transparent: true, priority: "P1", placement: "Every empty state (no games yet, nothing to show)" },
  { key: "not-found", group: "page", width: 768, height: 768, transparent: true, priority: "P2", placement: "404 page" },

  { key: "belt", group: "championship", width: 1200, height: 800, transparent: true, priority: "P1", placement: "Championship Belt page and the homepage belt feature, when there is no trophy photo" },

  award("boom-of-week", "Boom of the Week"),
  award("bust-of-week", "Bust of the Week"),
  award("bench-blunder", "Bench Blunder"),
  award("luckiest-win", "Luckiest Win"),
  award("unluckiest-loss", "Unluckiest Loss"),

  { key: "sacko", group: "shame", width: 768, height: 768, transparent: true, priority: "P1", placement: "Hall of Shame, beside Last Place by Season" },

  header("hall-of-shame", "Hall of Shame", "P1"),
  header("trade-tribunal", "Trade Tribunal", "P1"),
  header("power-rankings", "Power Rankings", "P1"),
  header("rivalries", "Rivalries", "P1"),
  header("matchups", "Matchups"),
  header("standings", "Standings"),
  header("records", "Records"),
  header("history", "History"),
  header("managers", "Managers"),
  header("draft-report-cards", "Draft Report Cards"),
  header("predictions", "Predictions"),
  header("news", "News"),
  header("championship-belt", "Championship Belt"),
];

/** Per-manager slots, keyed by the manager's slug (see managerSlug). */
export const MANAGER_SLOT_SPECS = {
  card: { width: 1000, height: 1400, transparent: false, priority: "P1", placement: "Manager profile, the trading card beside the name" },
  mugshot: { width: 1024, height: 1280, transparent: false, priority: "P2", placement: "Hall of Shame, next to each last-place finish" },
} as const satisfies Record<string, Omit<BrandSlot, "key" | "group">>;

export type ManagerSlotKind = keyof typeof MANAGER_SLOT_SPECS;

/** "Michael Barkemeyer" -> "michael-barkemeyer", matching /public/managers. */
export function managerSlug(displayName: string): string {
  return displayName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function managerSlotKey(kind: ManagerSlotKind, displayName: string): string {
  return `${kind}-${managerSlug(displayName)}`;
}

/** "Card_Blake Mire (1).PNG" -> "card-blake-mire": how inbox files find their slot. */
export function slotKeyFromFilename(file: string): string {
  return file
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The spec for any key, including per-manager ones ("card-blake-mire"). */
export function slotSpec(key: string): BrandSlot | null {
  const fixed = BRAND_SLOTS.find((s) => s.key === key);
  if (fixed) return fixed;
  const m = /^(card|mugshot)-([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(key);
  if (!m) return null;
  return { key, group: "manager", ...MANAGER_SLOT_SPECS[m[1] as ManagerSlotKind] };
}

export interface BrandAsset {
  src: string;
  width: number;
  height: number;
}

const ASSETS = manifest as Record<string, BrandAsset>;

/** The processed file for a slot, or null while the art hasn't arrived. */
export function brandAsset(key: string): BrandAsset | null {
  return ASSETS[key] ?? null;
}
