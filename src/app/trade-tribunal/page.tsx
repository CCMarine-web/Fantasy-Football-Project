import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getTradeTribunal } from "@/server/repositories/trade-tribunal-repository";
import { isAIConfigured } from "@/lib/env";
import { Gavel, ArrowRight } from "lucide-react";

export const metadata = { title: "Trade Tribunal" };

/** Differential (in rest-of-season points) at or above which a trade is a "fleece". */
const FLEECE_THRESHOLD = 25;

export default async function TradeTribunalPage() {
  const trades = await getTradeTribunal();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Court"
        title="Trade Tribunal"
        description="Every trade in league history, dragged before the court and judged on the cold evidence of rest-of-season production. The biggest fleeces are on top."
      />

      {!isAIConfigured() && trades.length > 0 ? (
        <p className="mt-4 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          Tribunal verdicts are placeholder text. Add an <code>OPENAI_API_KEY</code> for real
          commentary.
        </p>
      ) : null}

      <div className="mt-8 space-y-4">
        {trades.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title="No trades on record"
            description="Once managers start wheeling and dealing, every trade lands here for judgment."
          />
        ) : (
          trades.map((t) => {
            const isFleece =
              t.hindsightAvailable && t.differential != null && t.differential >= FLEECE_THRESHOLD;
            const winnerId =
              t.hindsightAvailable && t.sides.length === 2 && t.sides[0].hindsightPoints != null && t.sides[1].hindsightPoints != null
                ? (t.sides[0].hindsightPoints >= t.sides[1].hindsightPoints ? t.sides[0].managerId : t.sides[1].managerId)
                : null;

            return (
              <Card key={t.transactionId} className={isFleece ? "border-primary/40" : undefined}>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {isFleece ? (
                        <Badge className="bg-primary text-primary-foreground">Fleece</Badge>
                      ) : null}
                      {t.notable ? <Badge variant="secondary">Notable</Badge> : null}
                      {!t.hindsightAvailable ? (
                        <Badge variant="outline">Insufficient data</Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {t.seasonYear}
                        {t.week != null ? ` · Week ${t.week}` : ""}
                      </span>
                    </div>
                    {t.hindsightAvailable && t.differential != null ? (
                      <div className="text-right">
                        <p className="font-mono text-lg font-semibold tabular-nums text-primary">
                          +{t.differential.toFixed(1)}
                        </p>
                        <p className="text-xs text-muted-foreground">pt differential</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {t.sides.map((side) => (
                      <div
                        key={side.managerId}
                        className={`rounded-lg border p-3 ${winnerId === side.managerId ? "border-primary/50 bg-primary/5" : "border-border/60 bg-card/30"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            href={`/managers/${side.managerId}`}
                            className="font-heading text-base font-semibold hover:text-primary"
                          >
                            {side.managerName}
                          </Link>
                          {side.hindsightPoints != null ? (
                            <span className="font-mono text-sm tabular-nums text-foreground">
                              {side.hindsightPoints.toFixed(1)} pts
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          <ArrowRight className="h-3 w-3" aria-hidden />
                          <span>acquired</span>
                        </div>
                        <ul className="mt-1 space-y-0.5 text-sm text-foreground/90">
                          {side.acquired.length > 0 ? (
                            side.acquired.map((a, j) => <li key={j}>{a}</li>)
                          ) : (
                            <li className="text-muted-foreground">nothing of note</li>
                          )}
                        </ul>
                      </div>
                    ))}
                  </div>

                  <p className="border-l-2 border-primary/40 pl-3 text-sm text-foreground/90 italic">
                    {t.verdict}
                  </p>

                  {t.notes ? (
                    <p className="text-xs text-muted-foreground">{t.notes}</p>
                  ) : null}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
