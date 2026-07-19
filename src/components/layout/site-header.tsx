"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Menu, ShieldCheck, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { allNav, primaryNav } from "@/components/layout/nav-links";
import { logoutAction } from "@/app/login/actions";
import { BRAND } from "@/lib/branding";

export interface SiteHeaderUser {
  name?: string | null;
  email?: string | null;
  role: "ADMIN" | "MEMBER";
}

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "text-sm font-medium transition-colors hover:text-primary",
        isActive ? "text-primary" : "text-muted-foreground",
      )}
    >
      {label}
    </Link>
  );
}

export function SiteHeader({ user }: { user: SiteHeaderUser | null }) {
  const [open, setOpen] = useState(false);
  const isAdmin = user?.role === "ADMIN";

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="h-5 w-5" aria-hidden />
          </span>
          <span className="flex flex-col leading-none">
            <span className="font-heading text-lg font-semibold tracking-wide uppercase">
              {BRAND.name}
            </span>
            <span className="text-[11px] tracking-[0.2em] text-muted-foreground uppercase">
              {BRAND.tagline}
            </span>
          </span>
        </Link>

        <nav className="hidden items-center gap-6 lg:flex">
          {primaryNav.map((link) => (
            <NavItem key={link.href} {...link} />
          ))}
        </nav>

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
          ) : (
            <Button render={<Link href="/login" />} nativeButton={false} size="sm">
              Sign in
            </Button>
          )}
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
            <nav className="flex flex-col gap-4 px-4">
              {allNav.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="text-base font-medium text-foreground/90 hover:text-primary"
                >
                  {link.label}
                </Link>
              ))}
              <div className="mt-2 flex flex-col gap-2 border-t border-border/60 pt-4">
                {isAdmin ? (
                  <Link
                    href="/admin"
                    onClick={() => setOpen(false)}
                    className="text-base font-medium text-foreground/90 hover:text-primary"
                  >
                    Admin
                  </Link>
                ) : null}
                {user ? (
                  <form action={logoutAction}>
                    <button
                      type="submit"
                      className="text-base font-medium text-foreground/90 hover:text-primary"
                    >
                      Sign out
                    </button>
                  </form>
                ) : (
                  <Link
                    href="/login"
                    onClick={() => setOpen(false)}
                    className="text-base font-medium text-foreground/90 hover:text-primary"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
