import Link from "next/link";
import { Sparkles, Trophy } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auth } from "@/auth";
import {
  getPredictionSeason,
  listPredictions,
  scorePredictions,
  getCareerPredictionAccuracy,
} from "@/server/repositories/prediction-repository";

export const metadata = { title: "Predictions" };

export default async function PredictionsPage() {
  const info = await getPredictionSeason();

  if (!info) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="Preseason" title="Predictions" />
        <div className="mt-8">
          <EmptyState
            icon={Sparkles}
            title="No season yet"
            description="Once a season exists, managers can lock in their preseason predictions here."
          />
        </div>
      </div>
    );
  }

  const { season, deadline, locked } = info;
  const showScoring = season.status === "COMPLETE" || season.status === "IN_PROGRESS";

  const [predictions, scores, career, session] = await Promise.all([
    listPredictions(season.id),
    showScoring ? scorePredictions(season.id) : Promise.resolve([]),
    getCareerPredictionAccuracy(),
    auth(),
  ]);

  const user = session?.user;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={`${season.year} Season`}
        title="Preseason Predictions"
        description="Managers call their shots before the draft. Once the deadline hits, the picks lock and the Prophet Rating tracks who actually saw it coming."
        actions={
          user?.managerId && !locked ? (
            <Button render={<Link href="/predictions/submit" />} nativeButton={false} size="sm">
              {predictions.some((p) => p.managerId === user.managerId)
                ? "Edit your picks"
                : "Make your picks"}
            </Button>
          ) : !user ? (
            <Button
              render={<Link href="/login?callbackUrl=/predictions/submit" />}
              nativeButton={false}
              variant="outline"
              size="sm"
            >
              Sign in to predict
            </Button>
          ) : null
        }
      />

      <p className="mt-4 text-xs text-muted-foreground">
        {locked ? (
          <>
            Predictions locked{" "}
            <span className="text-foreground">
              {deadline.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
            .
          </>
        ) : (
          <>
            Predictions lock at the draft on{" "}
            <span className="text-foreground">
              {deadline.toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
            .
          </>
        )}
      </p>

      {/* Live / final scoring leaderboard */}
      {showScoring && scores.length > 0 ? (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="font-heading text-xl font-semibold tracking-wide uppercase">
              Prophet Rating {season.status === "COMPLETE" ? "— Final" : "— Live"}
            </h2>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Manager</th>
                      <th className="px-4 py-3 text-right font-medium">Champ</th>
                      <th className="px-4 py-3 text-right font-medium">Last</th>
                      <th className="px-4 py-3 text-right font-medium">Standings</th>
                      <th className="px-4 py-3 text-right font-medium">Bust</th>
                      <th className="px-4 py-3 text-right font-medium">Record</th>
                      <th className="px-4 py-3 text-right font-medium">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scores.map((s, i) => (
                      <tr key={s.managerId} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 font-mono text-muted-foreground tabular-nums">
                          {i + 1}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/managers/${s.managerId}`}
                            className="font-medium hover:text-primary"
                          >
                            {s.managerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {s.championPoints}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {s.lastPoints}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {s.standingsPoints}
                          <span className="ml-1 text-xs">({s.standingsHits})</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {s.bustPoints}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {s.ownRecordPoints.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                          {s.total.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {/* Everyone's predictions */}
      <section className="mt-10">
        <h2 className="mb-4 font-heading text-xl font-semibold tracking-wide uppercase">
          The Picks
        </h2>
        {predictions.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No predictions yet"
            description={
              locked
                ? "The deadline passed before anyone locked in their picks."
                : "Be the first to call it. Sign in and make your picks before the draft."
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {predictions.map((p) => (
              <Card key={p.id}>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/managers/${p.managerId}`}
                      className="font-heading text-lg font-semibold hover:text-primary"
                    >
                      {p.managerName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {p.submittedAt.toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Champ</Badge>
                      <span>{p.championName ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Last</Badge>
                      <span>{p.lastName ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Bust</Badge>
                      <span>{p.bustName ?? "—"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">Own record</Badge>
                      <span className="font-mono tabular-nums">
                        {p.predictedOwnWins ?? "?"}–{p.predictedOwnLosses ?? "?"}
                      </span>
                    </div>
                  </div>

                  {p.predictedStandingsNames.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Predicted order: </span>
                      {p.predictedStandingsNames.join(" · ")}
                    </div>
                  ) : null}

                  {p.boldTake ? (
                    <p className="border-l-2 border-primary/40 pl-3 text-sm text-foreground/90 italic">
                      “{p.boldTake}”
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Career accuracy leaderboard */}
      {career.length > 0 ? (
        <section className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="font-heading text-xl font-semibold tracking-wide uppercase">
              Career Prophets
            </h2>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground uppercase">
                      <th className="px-4 py-3 font-medium">#</th>
                      <th className="px-4 py-3 font-medium">Manager</th>
                      <th className="px-4 py-3 text-right font-medium">Seasons</th>
                      <th className="px-4 py-3 text-right font-medium">Avg</th>
                      <th className="px-4 py-3 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {career.map((c, i) => (
                      <tr key={c.managerId} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 font-mono text-muted-foreground tabular-nums">
                          {i + 1}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/managers/${c.managerId}`}
                            className="font-medium hover:text-primary"
                          >
                            {c.managerName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {c.seasonsScored}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {c.averageRating.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">
                          {c.totalRating.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}
