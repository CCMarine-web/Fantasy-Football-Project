import { Activity } from "lucide-react";
import { ManagerLink } from "@/components/shared/manager-link";
import type { RecordWatchItem } from "@/server/stats/record-watch";

/**
 * Record Watch: what the season in progress is threatening. Shown on Home and
 * Records. Season records themselves only ever count completed seasons; this is
 * where an unfinished season's 0-9 lives instead.
 */
export function RecordWatch({
  seasonYear,
  items,
  limit,
  className,
}: {
  seasonYear: number;
  items: RecordWatchItem[];
  limit?: number;
  className?: string;
}) {
  if (items.length === 0) return null;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <section className={className} aria-labelledby="record-watch-heading">
      <h2 id="record-watch-heading" className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
        <Activity className="h-4 w-4 text-primary" aria-hidden /> Record Watch · {seasonYear}
      </h2>
      <ul className="divide-y divide-border/60 rounded-lg border border-border/60 bg-card/60">
        {shown.map((item) => (
          <li key={item.key} className="px-4 py-3">
            <p className="text-sm font-semibold">
              <ManagerLink managerId={item.managerId}>{item.managerName}</ManagerLink>
              {item.headline.slice(item.managerName.length)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {seasonYear} is still being played, so it counts toward single-game and streak records but not season records — those use completed seasons only.
      </p>
    </section>
  );
}
