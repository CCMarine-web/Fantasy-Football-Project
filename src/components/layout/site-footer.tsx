import Link from "next/link";
import { allNav } from "@/components/layout/nav-links";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-start lg:justify-between lg:px-8">
        <div className="max-w-sm space-y-2">
          <p className="font-heading text-base font-semibold tracking-wide uppercase">
            The Gridiron Gazette
          </p>
          <p className="text-sm text-muted-foreground">
            The permanent record of the Gridiron Mayhem Fantasy Football League — every score,
            every trade, every rivalry, since founding.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {allNav.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted-foreground hover:text-primary">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-border/60 px-4 py-4 text-center text-xs text-muted-foreground sm:px-6 lg:px-8">
        &copy; {year} The Gridiron Gazette. Private league archive — not affiliated with the NFL or
        Sleeper.
      </div>
    </footer>
  );
}
