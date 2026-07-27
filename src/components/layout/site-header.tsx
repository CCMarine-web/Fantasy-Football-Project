"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, LogOut, Menu, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  INLINE_NAV_COUNT,
  isNavGroup,
  mobileNavGroups,
  primaryNav,
  type NavGroup,
  type NavLink as NavLinkType,
} from "@/components/layout/nav-links";
import { logoutAction } from "@/app/login/actions";
import { RatTrapMark } from "@/components/layout/rat-trap-mark";
import { BRAND } from "@/lib/branding";

export interface SiteHeaderUser {
  name?: string | null;
  email?: string | null;
  role: "ADMIN" | "MEMBER";
}

function useIsActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

function NavItem({ href, label, className }: { href: string; label: string; className?: string }) {
  const isActive = useIsActive()(href);
  return (
    <Link
      href={href}
      className={cn(
        "hover:text-primary text-sm font-medium whitespace-nowrap transition-colors",
        isActive ? "text-primary" : "text-muted-foreground",
        className,
      )}
    >
      {label}
    </Link>
  );
}

function NavDropdown({
  label,
  links,
  className,
}: {
  label: string;
  links: NavLinkType[];
  className?: string;
}) {
  const isActive = useIsActive();
  const active = links.some((l) => isActive(l.href));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "hover:text-primary flex items-center gap-1 text-sm font-medium whitespace-nowrap transition-colors outline-none",
          active ? "text-primary" : "text-muted-foreground",
          className,
        )}
      >
        {label}
        <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {links.map((l) => (
          <DropdownMenuItem key={l.href} render={<Link href={l.href} />}>
            {l.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SiteHeader({ user }: { user: SiteHeaderUser | null }) {
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === "ADMIN";

  const directLinks = primaryNav.filter((i): i is NavLinkType => !isNavGroup(i));
  const groups = primaryNav.filter(isNavGroup) as NavGroup[];
  /*
   * Why the "More" menu is permanent on desktop rather than appearing only at
   * narrow widths:
   *
   * Measured at 1920px, the eight direct links plus the History dropdown come
   * to 966px of nav. The header's content column is `max-w-7xl` (1280px), and
   * the masthead takes 280px of it with 64px of padding — leaving 904px. The
   * full row is 62px too wide, and no viewport fixes that because the column is
   * capped. Revealing everything at `xl` therefore pushed the page 14px wide at
   * exactly 1280px and spilled the nav outside the content column above it.
   *
   * So the tail always folds. Every destination is still one click away, and
   * both Draft Report Cards and Trade Tribunal are top-level entries — out of
   * the History archive group, and listed directly under "Main" on mobile.
   */
  const inline = directLinks.slice(0, INLINE_NAV_COUNT);
  const overflow = directLinks.slice(INLINE_NAV_COUNT);

  return (
    <header className="border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <span className="bg-primary text-primary-foreground flex h-9 w-9 items-center justify-center rounded-md">
            <RatTrapMark className="h-6 w-6" />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-lg font-semibold tracking-wide uppercase">
              {BRAND.name}
            </span>
            <span className="text-muted-foreground text-[13px] tracking-[0.2em] uppercase">
              {BRAND.tagline}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-5 lg:flex">
          {inline.map((item) => (
            <NavItem key={item.href} {...item} />
          ))}
          {overflow.length > 0 ? <NavDropdown label="More" links={overflow} /> : null}
          {groups.map((group) => (
            <NavDropdown key={group.label} label={group.label} links={group.links} />
          ))}
        </nav>

        {/*
          No public "Sign in" control: this is a read-only league archive and a
          sign-in prompt only invited confusion. Admin authentication is
          untouched — /login still works when visited directly, and the admin
          shortcut below appears once an admin has a session.
        */}
        <div className="hidden items-center gap-2 lg:flex">
          {isAdmin ? (
            <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" size="sm">
              <ShieldCheck className="h-4 w-4" />
              Admin
            </Button>
          ) : null}
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                {user.name ?? user.email ?? "Account"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<form action={logoutAction} className="w-full" />}>
                  <button type="submit" className="flex w-full items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open menu" />
            }
          >
            <Menu className="h-5 w-5" />
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle className="font-heading uppercase">Menu</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-5 overflow-y-auto px-4 pb-6">
              {mobileNavGroups.map((group) => (
                <div key={group.label} className="flex flex-col gap-2">
                  <p className="text-muted-foreground text-[13px] font-semibold tracking-[0.2em] uppercase">
                    {group.label}
                  </p>
                  {group.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={() => setOpen(false)}
                      className="text-foreground/90 hover:text-primary text-base font-medium"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ))}
              {isAdmin || user ? (
                <div className="border-border/60 mt-2 flex flex-col gap-2 border-t pt-4">
                  {isAdmin ? (
                    <Link
                      href="/admin"
                      onClick={() => setOpen(false)}
                      className="text-foreground/90 hover:text-primary text-base font-medium"
                    >
                      Admin
                    </Link>
                  ) : null}
                  {user ? (
                    <form action={logoutAction}>
                      <button
                        type="submit"
                        className="text-foreground/90 hover:text-primary text-base font-medium"
                      >
                        Sign out
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
