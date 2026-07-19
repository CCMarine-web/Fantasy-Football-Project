export interface NavLink {
  href: string;
  label: string;
}

export const primaryNav: NavLink[] = [
  { href: "/matchups", label: "Matchups" },
  { href: "/standings", label: "Standings" },
  { href: "/power-rankings", label: "Power Rankings" },
  { href: "/managers", label: "Managers" },
  { href: "/rivalries", label: "Rivalries" },
  { href: "/history", label: "History" },
  { href: "/records", label: "Records" },
];

export const secondaryNav: NavLink[] = [
  { href: "/news", label: "News" },
  { href: "/transactions", label: "Transactions" },
  { href: "/drafts", label: "Drafts" },
  { href: "/chat-lore", label: "Chat Lore" },
];

export const allNav: NavLink[] = [...primaryNav, ...secondaryNav];
