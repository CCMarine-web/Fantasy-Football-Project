import Link from "next/link";
import { CalendarDays } from "lucide-react";

/**
 * Points back at the Matchups page from the detailed archives it summarises.
 *
 * Standings, Transactions and News were separate destinations a visitor had to
 * know to visit. They still exist — a filterable transaction archive is
 * genuinely useful — but Matchups is now the way in, and every one of them says
 * so. (The page was the "Weekly League Hub" until the rename; /weekly redirects
 * to /matchups, so old links still land here.)
 */
export function MatchupsHubLink({ what }: { what: string }) {
  return (
    <p className="mt-6 flex items-start gap-2 rounded-md border border-border/60 bg-card/30 px-4 py-3 text-sm text-muted-foreground">
      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span>
        This is the full {what} archive.{" "}
        <Link href="/matchups" className="font-medium text-primary hover:underline">
          Matchups
        </Link>{" "}
        has this week&rsquo;s version alongside the featured game, standings, rankings and news.
      </span>
    </p>
  );
}
