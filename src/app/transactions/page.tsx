import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  getTransactionsPage,
  TRANSACTIONS_PAGE_SIZE,
  type TransactionView,
} from "@/server/repositories/transaction-repository";
import { MatchupsHubLink } from "@/components/shared/matchups-hub-link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { positionLabel } from "@/lib/format";
import { ArrowRightLeft, ChevronDown, Info, Search } from "lucide-react";
import type { TransactionType } from "@/generated/prisma/client";

export const metadata = { title: "Transactions" };

/*
 * Every control here is a plain link or a GET form, so the whole page stays
 * server-rendered and the filters survive a refresh, a bookmark and a share.
 * "Load More" grows a `shown` count in the URL rather than fetching in the
 * browser — the wire is ordered by a fixed timestamp, so a growing window can
 * neither skip nor duplicate a row.
 */

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

interface Filters {
  season: string;
  week: string;
  type: string;
  failed: string;
  manager: string;
  player: string;
  shown: string;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Partial<Record<keyof Filters, string>>>;
}) {
  const params = await searchParams;
  const requestedType = TYPES.find((t) => t.value === params.type)?.value;
  const requestedShown = params.shown ? Number(params.shown) : TRANSACTIONS_PAGE_SIZE;

  const page = await getTransactionsPage({
    seasonYear: params.season ? Number(params.season) : undefined,
    week: params.week ? Number(params.week) : undefined,
    type: requestedType,
    managerId: params.manager || undefined,
    playerQuery: params.player || undefined,
    successOnly: params.failed !== "1",
    limit: Number.isFinite(requestedShown) ? requestedShown : TRANSACTIONS_PAGE_SIZE,
  });

  const currentPeriod = page.periods.find((p) => p.year === page.seasonYear);
  const activeManager = page.managerOptions.find((m) => m.id === page.managerId);

  /**
   * Builds a link that changes one filter and leaves the rest alone.
   *
   * Changing any filter resets `shown`: keeping a 150-row window across a filter
   * change means a reader who narrows to one manager gets every row they have
   * ever appeared in, which is not what "filter" implies.
   */
  const href = (next: Partial<Filters>) => {
    const q = new URLSearchParams();
    const carry = (key: keyof Filters, current: string) => {
      const value = key in next ? (next[key] ?? "") : current;
      if (value) q.set(key, value);
    };
    carry("season", String(page.seasonYear ?? ""));
    carry("week", page.week != null ? String(page.week) : "");
    carry("type", page.type ?? "");
    carry("failed", page.successOnly ? "" : "1");
    carry("manager", page.managerId ?? "");
    carry("player", page.playerQuery ?? "");
    // Only ever carried when explicitly asked for, i.e. by Load More.
    if (next.shown) q.set("shown", next.shown);
    const s = q.toString();
    return s ? `/transactions?${s}` : "/transactions";
  };

  const hasFilters =
    page.week != null || page.type != null || page.managerId != null || page.playerQuery != null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Wire"
        title="Transactions"
        description="Every add, drop, claim and trade on record. A waiver claim that lost is shown as a claim that lost, not as an acquisition."
      />

      <MatchupsHubLink what="transaction" />

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

        {/* Manager. Built from the managers who actually appear in the wire, so
            it can never offer one with nothing behind it. */}
        {page.managerOptions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Manager
            </span>
            <Link
              href={href({ manager: "" })}
              aria-current={page.managerId == null ? "page" : undefined}
              className={
                page.managerId == null
                  ? "rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
              }
            >
              All
            </Link>
            {page.managerOptions.map((m) => (
              <Link
                key={m.id}
                href={href({ manager: m.id })}
                aria-current={page.managerId === m.id ? "page" : undefined}
                className={
                  page.managerId === m.id
                    ? "rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground"
                    : "rounded-md px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
                }
              >
                {m.displayName}
              </Link>
            ))}
          </div>
        ) : null}

        {/*
          Player search. A GET form so the query lands in the URL and the result
          is shareable and refreshable; the hidden inputs carry the other filters
          across, since a form submission replaces the whole query string.
        */}
        <form action="/transactions" method="get" className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="player"
            className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            Player
          </label>
          {page.seasonYear ? <input type="hidden" name="season" value={page.seasonYear} /> : null}
          {page.week != null ? <input type="hidden" name="week" value={page.week} /> : null}
          {page.type ? <input type="hidden" name="type" value={page.type} /> : null}
          {page.managerId ? <input type="hidden" name="manager" value={page.managerId} /> : null}
          {!page.successOnly ? <input type="hidden" name="failed" value="1" /> : null}
          <Input
            id="player"
            name="player"
            type="search"
            defaultValue={page.playerQuery ?? ""}
            placeholder="Search by player name"
            maxLength={60}
            className="w-full sm:w-64"
          />
          <Button type="submit" size="sm" variant="outline">
            <Search className="h-4 w-4" /> Search
          </Button>
          {page.playerQuery ? (
            <Link href={href({ player: "" })} className="text-sm text-primary hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

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
          {hasFilters ? (
            <Link
              href={href({ week: "", type: "", manager: "", player: "" })}
              className="font-medium text-primary hover:underline"
            >
              Clear all filters
            </Link>
          ) : null}
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
        {activeManager ? ` involving ${activeManager.displayName}` : ""}
        {page.playerQuery ? ` matching “${page.playerQuery}”` : ""}
        {page.hasMore ? ` — showing the most recent ${page.shown}` : ""}.
      </p>

      <div className="mt-4 space-y-3">
        {page.transactions.length === 0 ? (
          <EmptyState
            icon={ArrowRightLeft}
            title="Nothing here"
            description="No transactions match these filters. Try a different week or type."
          />
        ) : (
          page.transactions.map((tx) => {
            const hasDetail = tx.added.length > 0 || tx.dropped.length > 0;
            return (
              <Card
                key={tx.id}
                className={tx.outcome === "FAILED" ? "border-dashed py-0 opacity-80" : "py-0"}
              >
                <CardContent className="p-0">
                  {/*
                   * Expandable. The asset lists were always visible, which made a
                   * trade with eight pieces as tall as five other moves put
                   * together; the summary line is what a reader scans, and the
                   * detail is one click away. A move with nothing recorded
                   * against it has nothing to expand, so it renders flat rather
                   * than as a control that does nothing.
                   */}
                  <details className={hasDetail ? "group" : undefined}>
                    <summary
                      className={`flex list-none flex-col gap-2 px-6 py-4 ${hasDetail ? "cursor-pointer hover:bg-muted/30" : "cursor-default"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {/* The kind label already says whether a claim succeeded,
                            so the outcome badge only appears for the moves whose
                            label does not carry it. These used to render
                            identically, so seven managers all appeared to have
                            signed the same player. */}
                        <Badge className={`border ${OUTCOME_STYLE[tx.outcome]}`}>{tx.kindLabel}</Badge>
                        {tx.type !== "WAIVER" && tx.outcome !== "SUCCESSFUL" ? (
                          <Badge className={`border ${OUTCOME_STYLE[tx.outcome]}`}>
                            {tx.outcomeLabel}
                          </Badge>
                        ) : null}
                        {tx.faabSpent != null && tx.faabSpent > 0 ? (
                          <Badge variant="secondary">${tx.faabSpent} FAAB</Badge>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {tx.seasonYear}
                          {tx.week != null ? ` · Week ${tx.week}` : ""}
                        </span>
                        {hasDetail ? (
                          <ChevronDown
                            className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                            aria-hidden
                          />
                        ) : null}
                      </div>
                      <p className="text-sm text-foreground/90">{tx.summary}.</p>
                      {hasDetail ? <span className="sr-only">Show what moved</span> : null}
                    </summary>

                    {hasDetail ? (
                      <div className="border-t border-border/50 px-6 py-3">
                        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                          {tx.added.length > 0 ? (
                            <div>
                              <p className="text-xs tracking-wide text-field uppercase">In</p>
                              <ul className="mt-1 space-y-0.5">
                                {tx.added.map((a) => (
                                  <li key={a.id} className="text-muted-foreground">
                                    <span className="font-medium text-foreground">
                                      {a.playerName ?? a.otherAsset ?? "unnamed"}
                                    </span>
                                    {a.position ? ` ${positionLabel(a.position)}` : ""} → {a.managerName}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {tx.dropped.length > 0 ? (
                            <div>
                              <p className="text-xs tracking-wide text-destructive uppercase">Out</p>
                              <ul className="mt-1 space-y-0.5">
                                {tx.dropped.map((a) => (
                                  <li key={a.id} className="text-muted-foreground">
                                    <span className="font-medium text-foreground">
                                      {a.playerName ?? a.otherAsset ?? "unnamed"}
                                    </span>
                                    {a.position ? ` ${positionLabel(a.position)}` : ""} ←{" "}
                                    {a.managerName}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </details>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Load More. A link, not a fetch: the URL stays honest about what is on
          screen, so a refresh or a shared link shows the same rows. */}
      {page.hasMore ? (
        <div className="mt-6 flex flex-col items-center gap-2">
          <Button
            render={<Link href={href({ shown: String(page.shown + TRANSACTIONS_PAGE_SIZE) })} />}
            nativeButton={false}
            variant="outline"
          >
            Load {Math.min(TRANSACTIONS_PAGE_SIZE, page.totalMatching - page.shown)} more
          </Button>
          <p className="text-xs text-muted-foreground">
            Showing {page.shown} of {page.totalMatching}.
          </p>
        </div>
      ) : page.transactions.length > TRANSACTIONS_PAGE_SIZE ? (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          All {page.totalMatching} shown.
        </p>
      ) : null}
    </div>
  );
}
