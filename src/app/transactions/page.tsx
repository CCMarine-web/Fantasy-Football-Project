import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getTransactionsPage,
  type TransactionView,
} from "@/server/repositories/transaction-repository";
import { ArrowRightLeft, Info } from "lucide-react";
import type { TransactionType } from "@/generated/prisma/client";

export const metadata = { title: "Transactions" };

const TYPES: { value: TransactionType; label: string }[] = [
  { value: "WAIVER", label: "Waiver claims" },
  { value: "FREE_AGENT", label: "Free-agent pickups" },
  { value: "TRADE", label: "Trades" },
  { value: "COMMISSIONER", label: "Commissioner actions" },
];

const OUTCOME_STYLE: Record<TransactionView["outcome"], string> = {
  SUCCESSFUL: "bg-field/15 text-field border-field/40",
  FAILED: "bg-muted text-muted-foreground border-border/60",
  PENDING: "bg-gold/15 text-gold border-gold/40",
  REVERSED: "bg-destructive/15 text-destructive border-destructive/40",
};

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; week?: string; type?: string; failed?: string }>;
}) {
  const params = await searchParams;
  const requestedType = TYPES.find((t) => t.value === params.type)?.value;

  const page = await getTransactionsPage({
    seasonYear: params.season ? Number(params.season) : undefined,
    week: params.week ? Number(params.week) : undefined,
    type: requestedType,
    successOnly: params.failed !== "1",
  });

  const currentPeriod = page.periods.find((p) => p.year === page.seasonYear);

  /** Builds a link that changes one filter and leaves the rest alone. */
  const href = (next: Partial<{ season: string; week: string; type: string; failed: string }>) => {
    const q = new URLSearchParams();
    const season = next.season ?? String(page.seasonYear ?? "");
    if (season) q.set("season", season);
    const week = "week" in next ? next.week : page.week != null ? String(page.week) : "";
    if (week) q.set("week", week);
    const type = "type" in next ? next.type : (page.type ?? "");
    if (type) q.set("type", type);
    const failed = "failed" in next ? next.failed : page.successOnly ? "" : "1";
    if (failed) q.set("failed", failed);
    const s = q.toString();
    return s ? `/transactions?${s}` : "/transactions";
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Wire"
        title="Transactions"
        description="Every add, drop, claim and trade on record. A waiver claim that lost is shown as a claim that lost, not as an acquisition."
      />

      {/*
       * The filters are built from the periods that actually contain data, so
       * they can never offer a season or week that shows nothing, and the page
       * opens on the newest period instead of a slice across three years.
       */}
      <div className="mt-8 space-y-3 rounded-lg border border-border/60 bg-card/30 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Season
          </span>
          {page.periods.map((p) => (
            <Link
              key={p.year}
              href={href({ season: String(p.year), week: "" })}
              aria-current={p.year === page.seasonYear ? "page" : undefined}
              className={
                p.year === page.seasonYear
                  ? "rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              {p.year}
            </Link>
          ))}
        </div>

        {currentPeriod && currentPeriod.weeks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Week
            </span>
            <Link
              href={href({ week: "" })}
              aria-current={page.week == null ? "page" : undefined}
              className={
                page.week == null
                  ? "rounded-md bg-primary px-2.5 py-1 text-sm font-medium text-primary-foreground"
                  : "rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              All
            </Link>
            {currentPeriod.weeks.map((w) => (
              <Link
                key={w}
                href={href({ week: String(w) })}
                aria-current={page.week === w ? "page" : undefined}
                className={
                  page.week === w
                    ? "rounded-md bg-primary px-2.5 py-1 text-sm font-medium tabular-nums text-primary-foreground"
                    : "rounded-md px-2.5 py-1 text-sm tabular-nums text-muted-foreground hover:text-foreground"
                }
              >
                {w}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Type
          </span>
          <Link
            href={href({ type: "" })}
            aria-current={page.type == null ? "page" : undefined}
            className={
              page.type == null
                ? "rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            All
          </Link>
          {TYPES.map((t) => (
            <Link
              key={t.value}
              href={href({ type: t.value })}
              aria-current={page.type === t.value ? "page" : undefined}
              className={
                page.type === t.value
                  ? "rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              {t.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/40 pt-3 text-sm">
          <span className="text-muted-foreground">
            {page.successOnly
              ? "Showing completed moves only."
              : "Showing unsuccessful waiver claims as well."}
          </span>
          <Link
            href={href({ failed: page.successOnly ? "1" : "" })}
            className="font-medium text-primary hover:underline"
          >
            {page.successOnly ? "Include failed claims" : "Hide failed claims"}
          </Link>
        </div>
      </div>

      {page.seasonsWithoutData.length > 0 ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            No transactions are on record for {page.seasonsWithoutData.join(", ")}. ESPN does not
            retain transaction history for archived seasons, so those years are a gap in the data
            rather than years in which nobody made a move.
          </span>
        </p>
      ) : null}

      <p className="mt-4 text-sm text-muted-foreground">
        {page.totalMatching} transaction{page.totalMatching === 1 ? "" : "s"} in{" "}
        {page.seasonYear ?? "this period"}
        {page.week != null ? `, week ${page.week}` : ""}
        {page.transactions.length < page.totalMatching
          ? ` — showing the most recent ${page.transactions.length}`
          : ""}
        .
      </p>

      <div className="mt-4 space-y-3">
        {page.transactions.length === 0 ? (
          <EmptyState
            icon={ArrowRightLeft}
            title="Nothing here"
            description="No transactions match these filters. Try a different week or type."
          />
        ) : (
          page.transactions.map((tx) => (
            <Card key={tx.id} className={tx.outcome === "FAILED" ? "border-dashed opacity-80" : undefined}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{tx.kindLabel}</Badge>
                  {/* A failed claim is labelled a failed claim. These used to
                      render identically to successful ones, so seven managers
                      all appeared to have signed the same player. */}
                  {tx.outcome !== "SUCCESSFUL" || tx.type === "WAIVER" ? (
                    <Badge className={`border ${OUTCOME_STYLE[tx.outcome]}`}>{tx.outcomeLabel}</Badge>
                  ) : null}
                  {tx.faabSpent != null && tx.faabSpent > 0 ? (
                    <Badge variant="secondary">${tx.faabSpent} FAAB</Badge>
                  ) : null}
                  <span className="text-xs text-muted-foreground">
                    {tx.seasonYear}
                    {tx.week != null ? ` · Week ${tx.week}` : ""}
                  </span>
                </div>

                <p className="text-sm text-foreground/90">{tx.summary}.</p>

                {tx.added.length > 0 || tx.dropped.length > 0 ? (
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    {tx.added.length > 0 ? (
                      <p>
                        <span className="text-field">In:</span>{" "}
                        <span className="text-muted-foreground">
                          {tx.added
                            .map(
                              (a) =>
                                `${a.playerName ?? a.otherAsset ?? "unnamed"}${a.position ? ` (${a.position})` : ""} → ${a.managerName}`,
                            )
                            .join(", ")}
                        </span>
                      </p>
                    ) : null}
                    {tx.dropped.length > 0 ? (
                      <p>
                        <span className="text-destructive">Out:</span>{" "}
                        <span className="text-muted-foreground">
                          {tx.dropped
                            .map(
                              (a) =>
                                `${a.playerName ?? a.otherAsset ?? "unnamed"}${a.position ? ` (${a.position})` : ""} ← ${a.managerName}`,
                            )
                            .join(", ")}
                        </span>
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
