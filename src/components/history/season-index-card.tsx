import Link from "next/link";
import { Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SeasonIndexCard, SeasonIndexPerson } from "@/server/repositories/history-repository";

function Line({ label, person }: { label: string; person: SeasonIndexPerson | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="truncate text-sm" title={person ? `${person.name}${person.note ? ` (${person.note})` : ""}` : undefined}>
        {person ? (
          <>
            <span className="font-medium">{person.name}</span>
            {person.note ? <span className="text-muted-foreground"> · {person.note}</span> : null}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  );
}

/**
 * One season on the /history index. The whole card links to the season page,
 * so the names inside are plain text (no links nested in a link). A season in
 * progress says so and claims no final result: no champion, no seed, no
 * last place until the games are played.
 */
export function SeasonIndexCardView({ season }: { season: SeasonIndexCard }) {
  return (
    <Link href={`/history/${season.year}`} className="block">
      <Card className="transition-colors hover:border-primary/60">
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-heading text-xl font-semibold">{season.year}</p>
              <Badge variant={season.inProgress ? "secondary" : "outline"} className="mt-1 text-[12px] uppercase">
                {season.inProgress ? (season.status === "UPCOMING" ? "Upcoming" : "In progress") : "Complete"}
              </Badge>
            </div>
            {season.champion ? (
              <div className="flex min-w-0 items-center gap-2 text-right">
                <div className="min-w-0">
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">Champion</p>
                  <p className="truncate font-medium">{season.champion.name}</p>
                </div>
                <Trophy className="h-5 w-5 shrink-0 text-gold" aria-hidden />
              </div>
            ) : (
              <span className="text-right text-sm text-muted-foreground">
                {season.inProgress ? "Still being played" : "No champion recorded"}
              </span>
            )}
          </div>
          {season.inProgress ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Final results land when the title game does. Until then, nobody gets to call themselves anything.
            </p>
          ) : (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border/60 pt-3">
              <Line label="Runner-up" person={season.runnerUp} />
              <Line label="#1 seed" person={season.topSeed} />
              <Line label="Points leader" person={season.pointsLeader} />
              <Line label="Last place" person={season.lastPlace} />
            </dl>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
