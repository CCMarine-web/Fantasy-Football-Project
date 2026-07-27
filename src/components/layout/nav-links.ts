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
 * Top nav. Eight direct links plus one "History" archive group.
 *
 * Draft Report Cards and Trade Tribunal are top-level rather than buried in the
 * History dropdown — they are recurring features people come back for, not
 * archive material. That takes the direct-link count high enough that the row
 * no longer fits every desktop width, so the header renders the tail of this
 * list into a "More" overflow menu below `xl` (see site-header.tsx). Ordering
 * therefore matters: the least-essential items sit last so they are the ones
 * that fold away first.
 */
export const primaryNav: NavItem[] = [
  { href: "/matchups", label: "Matchups" },
  { href: "/standings", label: "Standings" },
  { href: "/power-rankings", label: "Power Rankings" },
  { href: "/managers", label: "Managers" },
  { href: "/rivalries", label: "Rivalries" },
  { href: "/draft-report-cards", label: "Draft Report Cards" },
  { href: "/trade-tribunal", label: "Trade Tribunal" },
  { href: "/news", label: "News" },
  {
    label: "History",
    links: [
      { href: "/history", label: "Season History" },
      { href: "/records", label: "Records" },
      { href: "/hall-of-shame", label: "Hall of Shame" },
      { href: "/championship-belt", label: "Championship History" },
      { href: "/drafts", label: "Drafts" },
      { href: "/transactions", label: "Transactions" },
    ],
  },
];

/**
 * How many of the direct links stay inline on a medium-width desktop. The rest
 * fold into the "More" menu. The History group always renders as its own
 * dropdown after them.
 */
export const INLINE_NAV_COUNT = 5;

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
