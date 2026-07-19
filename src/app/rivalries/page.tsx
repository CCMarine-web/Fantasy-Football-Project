import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getComputedRivalries } from "@/server/repositories/computed-rivalries-repository";
import { isAIConfigured } from "@/lib/env";
import { Swords } from "lucide-react";

export const metadata = { title: "Rivalries" };

export default async function RivalriesPage() {
  const rivalries = await getComputedRivalries();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Bad Blood"
        title="Rivalries"
        description="Every manager pairing with real history, ranked by how much it matters — meetings, playoff stakes, and how close it's been."
      />

      {!isAIConfigured() && rivalries.length > 0 ? (
        <p className="mt-4 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          Rivalry one-liners are placeholder text. Add an <code>OPENAI_API_KEY</code> for real
          commentary.
        </p>
      ) : null}

      <div className="mt-8 space-y-4">
        {rivalries.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="No rivalries yet"
            description="Rivalries are computed once managers have met at least three times."
          />
        ) : (
          rivalries.map((r, i) => (
            <Card key={r.key} className={i === 0 ? "border-primary/40" : undefined}>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {i === 0 ? <Badge className="bg-primary text-primary-foreground">Top Rivalry</Badge> : null}
                    <Link href={`/managers/${r.managerAId}`} className="font-heading text-lg font-semibold hover:text-primary">
                      {r.managerAName}
                    </Link>
                    <span className="text-muted-foreground">vs</span>
                    <Link href={`/managers/${r.managerBId}`} className="font-heading text-lg font-semibold hover:text-primary">
                      {r.managerBName}
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-xl font-semibold tabular-nums">
                      {r.aWins}-{r.bWins}
                      {r.ties ? `-${r.ties}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.gamesPlayed} meetings</p>
                  </div>
                </div>

                <p className="text-sm text-foreground/90">{r.blurb}</p>

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                  <span>
                    Total pts:{" "}
                    <span className="font-mono text-foreground">
                      {r.aPoints.toFixed(0)}–{r.bPoints.toFixed(0)}
                    </span>
                  </span>
                  <span>
                    Avg margin: <span className="font-mono text-foreground">{r.avgMargin.toFixed(1)}</span>
                  </span>
                  <span>
                    Streak: <span className="text-foreground">{r.currentStreak}</span>
                  </span>
                  <span>
                    Playoff meetings: <span className="font-mono text-foreground">{r.playoffMeetings}</span>
                  </span>
                  {r.closest ? (
                    <span>
                      Closest:{" "}
                      <span className="font-mono text-foreground">
                        {r.closest.margin} pts ({r.closest.year})
                      </span>
                    </span>
                  ) : null}
                  {r.biggest ? (
                    <span>
                      Biggest:{" "}
                      <span className="font-mono text-foreground">
                        {r.biggest.margin} pts ({r.biggest.year})
                      </span>
                    </span>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
