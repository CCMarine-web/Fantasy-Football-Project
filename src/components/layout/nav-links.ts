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
 * Top nav: a few direct links plus two dropdown groups so the ~16 destinations
 * stay usable. "League" = people/competition views; "History" = the archive.
 */
export const primaryNav: NavItem[] = [
  { href: "/matchups", label: "Matchups" },
  { href: "/standings", label: "Standings" },
  { href: "/power-rankings", label: "Power Rankings" },
  { href: "/managers", label: "Managers" },
  { href: "/rivalries", label: "Rivalries" },
  { href: "/news", label: "News" },
  {
    label: "History",
    links: [
      { href: "/history", label: "Season History" },
      { href: "/records", label: "Records" },
      { href: "/hall-of-shame", label: "Hall of Shame" },
      { href: "/championship-belt", label: "Championship History" },
      { href: "/trade-tribunal", label: "Trade Tribunal" },
      { href: "/draft-report-cards", label: "Draft Report Cards" },
      { href: "/drafts", label: "Drafts" },
      { href: "/transactions", label: "Transactions" },
    ],
  },
];

/** Extra destinations not in the top nav but linked in the footer. */
const footerExtras: NavLink[] = [{ href: "/predictions", label: "Predictions" }];

/** Flat list of every destination (used by the mobile menu + footer). */
export const allNavLinks: NavLink[] = [
  ...primaryNav.flatMap((item) => (isNavGroup(item) ? item.links : [item])),
  ...footerExtras,
];

/** Grouped structure for the mobile menu (direct links collected under "Main"). */
export const mobileNavGroups: NavGroup[] = [
  { label: "Main", links: primaryNav.filter((i): i is NavLink => !isNavGroup(i)) },
  ...primaryNav.filter(isNavGroup),
];
