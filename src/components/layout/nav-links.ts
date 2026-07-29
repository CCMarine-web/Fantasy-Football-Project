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
 * Top nav, led by the Weekly League Hub.
 *
 * Matchups, Standings, Transactions and News used to sit here as four separate
 * top-level items, which meant answering "what happened this week" took four
 * page loads. /weekly answers it once and links onward, so it takes the first
 * slot and those four move into the "This Week" group beside it — they still
 * exist, they are simply no longer the way in.
 *
 * Draft Cards and Trade Tribunal are top-level rather than buried in History —
 * they are recurring features people come back for, not archive material.
 * "Draft Cards" is the nav label for the Draft Report Cards page: the full name
 * measured 148px against a header column with only ~60px to spare, so the short
 * form is what makes the item fit inline at all. The page keeps its full title.
 *
 * Chat is the public shoutbox, deliberately near the front — it is the only
 * page a visitor can actually interact with.
 *
 * Ordering matters: the last items are the ones that fold into "More" on a
 * narrower desktop (see site-header.tsx).
 */
export const primaryNav: NavItem[] = [
  { href: "/weekly", label: "Weekly" },
  { href: "/power-rankings", label: "Power Rankings" },
  { href: "/managers", label: "Managers" },
  { href: "/rivalries", label: "Rivalries" },
  { href: "/chat", label: "Chat" },
  { href: "/draft-report-cards", label: "Draft Cards" },
  { href: "/trade-tribunal", label: "Trade Tribunal" },
  {
    label: "This Week",
    links: [
      { href: "/weekly", label: "Weekly League Hub" },
      { href: "/matchups", label: "All Matchups" },
      { href: "/standings", label: "Full Standings" },
      { href: "/transactions", label: "Transaction Archive" },
      { href: "/news", label: "News Archive" },
    ],
  },
  {
    label: "History",
    links: [
      { href: "/history", label: "Season History" },
      { href: "/records", label: "Records" },
      { href: "/hall-of-shame", label: "Hall of Shame" },
      { href: "/championship-belt", label: "Championship History" },
      { href: "/drafts", label: "Drafts" },
    ],
  },
];

/**
 * How many direct links sit inline at each desktop tier. The rest fold into a
 * "More" menu, where every destination stays a separate, individually-labelled
 * item — nothing is ever combined.
 *
 * These are measured, not guessed. The row now measures:
 *   Weekly 60 · Power Rankings 127 · Managers 78 · Rivalries 67 · Chat 37 ·
 *   Draft Cards 91 · Trade Tribunal 110, then the two dropdowns
 *   This Week 85 · History 74, with a 16px gap.
 *
 * The masthead takes 280px and the container 64px of padding, so:
 *   lg  (1024px): 680px of room -> 4 links + More + both dropdowns (642px)
 *   xl  (1280px): 936px of room -> all 7 links + both dropdowns (857px), so
 *                 "More" disappears entirely from here up
 *
 * Folding Matchups, Standings, Transactions and News into the "This Week"
 * group is what bought the room: the row was ten items wide and needed a
 * 1298px container it could never have while the header is capped at
 * `max-w-7xl` (1280px) — see site-header.tsx.
 */
export const INLINE_NAV_LG = 4;
export const INLINE_NAV_XL = 7;

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
  { href: "/draft-report-cards", label: "Draft Report Cards" },
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
  { label: "Main", links: primaryNav.filter((i): i is NavLink => !isNavGroup(i)) },
  ...primaryNav.filter(isNavGroup),
];
