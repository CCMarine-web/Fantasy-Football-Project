import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DraftTab = "board" | "grades" | "revisited";

export const DRAFT_TABS: { key: DraftTab; label: string }[] = [
  { key: "board", label: "Board" },
  { key: "grades", label: "Grades" },
  { key: "revisited", label: "Revisited" },
];

export function parseDraftTab(value: string | undefined): DraftTab {
  return DRAFT_TABS.some((t) => t.key === value) ? (value as DraftTab) : "grades";
}

/** The page's own URL for a tab + season (+ board view). */
export function draftsHref(tab: DraftTab, season: number | null, view?: "position" | "hindsight"): string {
  const params = new URLSearchParams({ tab });
  if (season != null) params.set("season", String(season));
  if (view === "hindsight") params.set("view", view);
  return `/draft-report-cards?${params.toString()}`;
}

/**
 * Board | Grades | Revisited. Plain links rather than a client tab widget: each
 * tab is its own URL, so a tab can be shared into the group chat and the page
 * needs no JavaScript to switch.
 */
export function DraftTabs({ active, season }: { active: DraftTab; season: number | null }) {
  return (
    <nav aria-label="Draft sections" className="mt-6 border-b border-border/60">
      <ul className="-mb-px flex gap-1">
        {DRAFT_TABS.map((t) => {
          const current = t.key === active;
          return (
            <li key={t.key}>
              <Link
                href={draftsHref(t.key, season)}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 font-heading text-sm font-semibold tracking-wide uppercase transition-colors sm:px-4",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Season chips; each keeps the tab (and board view) you are on. */
export function DraftSeasonPicker({
  years,
  active,
  tab,
  view,
}: {
  years: number[];
  active: number | null;
  tab: DraftTab;
  view?: "position" | "hindsight";
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" aria-label="Season">
      {years.map((year) => (
        <Link key={year} href={draftsHref(tab, year, view)} aria-current={year === active ? "page" : undefined} className="inline-flex min-h-11 items-center">
          <Badge variant={year === active ? "default" : "outline"}>{year}</Badge>
        </Link>
      ))}
    </div>
  );
}
