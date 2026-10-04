import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { getCurrentSeason } from "@/server/repositories/season-repository";
import { getDraftForSeasonYear, listDraftSeasons } from "@/server/repositories/draft-repository";
import { positionLabel } from "@/lib/format";
import { ClipboardList } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Drafts" };

/**
 * A defence's public position label is "Team D/ST", which beside "Houston
 * Texans" filled a phone row and truncated mid-label. On the board it is the
 * short "D/ST" tag, and a name that already ends in D/ST is not doubled.
 */
function pickLabel(player: { firstName: string; lastName: string; position: string }) {
  const name = `${player.firstName} ${player.lastName}`.trim();
  const position = positionLabel(player.position);
  if (position !== "Team D/ST") return { name, position };
  return { name: name.replace(/\s+D\/?ST$/i, ""), position: "D/ST" };
}

export default async function DraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season: seasonParam } = await searchParams;
  const seasons = await listDraftSeasons();
  const currentSeason = await getCurrentSeason();
  const year = seasonParam ? Number(seasonParam) : (currentSeason?.year ?? seasons[0]?.year);

  const draft = year ? await getDraftForSeasonYear(year) : null;
  type DraftPick = NonNullable<typeof draft>["picks"][number];

  const rounds = new Map<number, DraftPick[]>();
  if (draft) {
    for (const pick of draft.picks) {
      const list = rounds.get(pick.round) ?? [];
      list.push(pick);
      rounds.set(pick.round, list);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="On the Clock"
        title="Drafts"
        description="Full draft boards for every season, pick by pick."
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {seasons.map((s) => (
          <Link key={s.id} href={`/drafts?season=${s.year}`}>
            <Badge variant={s.year === year ? "default" : "outline"}>{s.year}</Badge>
          </Link>
        ))}
      </div>

      <div className="mt-8">
        {!draft ? (
          <EmptyState icon={ClipboardList} title="No draft recorded for this season yet" />
        ) : (
          <div className="space-y-6">
            {Array.from(rounds.entries()).map(([round, picks]) => (
              <div key={round}>
                <h2 className="mb-2 font-heading text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                  Round {round}
                </h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {picks.map((pick) => {
                    const label = pick.player ? pickLabel(pick.player) : null;
                    return (
                      <div
                        key={pick.id}
                        className="flex items-center gap-2 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
                      >
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">{pick.pickNumber}.</span>
                        {/* Up to two lines, so a long name beside a KEEP badge
                            or a long manager name wraps rather than truncating. */}
                        <span className="line-clamp-2 min-w-0 flex-1 break-words">
                          {label ? label.name : "—"}
                          {label ? (
                            <span className="ml-1 text-xs whitespace-nowrap text-muted-foreground">
                              {label.position}
                            </span>
                          ) : null}
                        </span>
                        {/* The manager side is capped so it can never squeeze
                            the player name down to nothing. */}
                        <span className="flex max-w-[45%] shrink-0 items-center gap-2">
                          <span className="truncate text-xs text-muted-foreground">
                            {pick.manager?.displayName}
                          </span>
                          {pick.isKeeper ? (
                            <Badge variant="outline" className="shrink-0 text-[11px]">
                              KEEP
                            </Badge>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
