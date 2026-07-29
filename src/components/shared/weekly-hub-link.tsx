import Link from "next/link";
import { CalendarDays } from "lucide-react";

/**
 * Points back at the Weekly League Hub from the detailed pages it summarises.
 *
 * Matchups, Standings, Transactions and News were four separate destinations a
 * visitor had to know to visit. They still exist — a full-season matchup list
 * and a filterable transaction archive are genuinely useful — but the hub is
 * now the way in, and every one of them says so.
 */
export function WeeklyHubLink({ what }: { what: string }) {
  return (
    <p className="mt-6 flex items-start gap-2 rounded-md border border-border/60 bg-card/30 px-4 py-3 text-sm text-muted-foreground">
      <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span>
        This is the full {what} archive.{" "}
        <Link href="/weekly" className="font-medium text-primary hover:underline">
          The Weekly League Hub
        </Link>{" "}
        has this week&rsquo;s version alongside the scores, standings, rankings and news.
      </span>
    </p>
  );
}
