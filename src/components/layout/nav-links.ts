export interface NavLink {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  links: NavLink[];
}

export type NavItem = NavLink | NavGroup;

export function isNavGroup(item: NavItem): item is NavGroup {
  return "links" in item;
}

/**
 * Top nav (Nov 2026 redesign): Standings, Matchups, Power Rankings, Managers,
 * History, More. Standings had been buried under "This Week"; it is the page
 * most people want, so it leads. Everything else sits in "More" as separate,
 * individually-labelled items — nothing is combined or removed.
 *
 * At the new type scale the five links plus "More" measure under 500px, so
 * the whole row fits inline from `lg` (1024px) up; there are no fold tiers.
 * Home is the masthead on desktop and the first item of the mobile menu.
 */
export const primaryNav: NavItem[] = [
  { href: "/standings", label: "Standings" },
  { href: "/matchups", label: "Matchups" },
  { href: "/power-rankings", label: "Power Rankings" },
  { href: "/managers", label: "Managers" },
  { href: "/history", label: "History" },
  {
    label: "More",
    links: [
      { href: "/rivalries", label: "Rivalries" },
      { href: "/draft-report-cards", label: "Drafts" },
      { href: "/trade-tribunal", label: "Trade Tribunal" },
      { href: "/transactions", label: "Transactions" },
      { href: "/news", label: "News" },
      { href: "/records", label: "Records" },
      { href: "/hall-of-shame", label: "Hall of Shame" },
      { href: "/championship-belt", label: "Championship Belt" },
    ],
  },
];

/**
 * Extra destinations not in the top nav but linked in the footer. Draft Report
 * Cards appears in the footer under its FULL name, so the short nav label never
 * leaves a visitor unsure what the page is.
 *
 * Predictions is deliberately NOT here. Submitting one requires an account
 * linked to a manager, and public sign-in has been removed, so every visitor
 * who followed the footer link hit a page whose only call to action was a
 * "Sign in to predict" button they could not use. The page still exists and is
 * linked from the commissioner's dashboard; it is simply not advertised to
 * people who cannot take part.
 */
const footerExtras: NavLink[] = [
  { href: "/draft-report-cards", label: "Drafts & Report Cards" },
];

/**
 * Flat list of every destination (used by the footer). De-duplicated by href so
 * Draft Report Cards, which appears in both `primaryNav` (short label) and
 * `footerExtras` (full label), is listed once — under the full name.
 */
export const allNavLinks: NavLink[] = (() => {
  const seen = new Map<string, NavLink>();
  for (const link of primaryNav.flatMap((item) => (isNavGroup(item) ? item.links : [item]))) {
    seen.set(link.href, link);
  }
  for (const link of footerExtras) seen.set(link.href, link);
  return [...seen.values()];
})();

/** Grouped structure for the mobile menu (direct links collected under "Main"). */
export const mobileNavGroups: NavGroup[] = [
  { label: "Main", links: [{ href: "/", label: "Home" }, ...primaryNav.filter((i): i is NavLink => !isNavGroup(i))] },
  ...primaryNav.filter(isNavGroup),
];
