export interface NavLink {
  href: string;
  label: string;
}

export const primaryNav: NavLink[] = [
  { href: "/matchups", label: "Matchups" },
  { href: "/standings", label: "Standings" },
  { href: "/managers", label: "Managers" },
  { href: "/history", label: "History" },
  { href: "/records", label: "Records" },
  { href: "/news", label: "News" },
];

export const secondaryNav: NavLink[] = [
  { href: "/rivalries", label: "Rivalries" },
  { href: "/transactions", label: "Transactions" },
  { href: "/drafts", label: "Drafts" },
  { href: "/chat-lore", label: "Chat Lore" },
];

export const allNav: NavLink[] = [...primaryNav, ...secondaryNav];
