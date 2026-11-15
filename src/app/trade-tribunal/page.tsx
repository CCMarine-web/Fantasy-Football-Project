import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { managerPath } from "@/lib/slug";
import Link from "next/link";
import { AiText } from "@/components/shared/ai-text";
import { tradeVerdictTexts } from "@/server/text/page-texts";
import type { RenderedText } from "@/server/text/read";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { DISCLOSURE_SUMMARY_CLASS, DisclosureChevron } from "@/components/shared/disclosure";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  getTradeTribunal,
  isHeadlineTrade,
  type TradeTribunalView,
} from "@/server/repositories/trade-tribunal-repository";
import { LOPSIDEDNESS_LABEL, type Lopsidedness } from "@/server/stats/trade-value";
import { ordinal, positionLabel } from "@/lib/format";
import { Gavel, ArrowRight, Info } from "lucide-react";
import { prisma } from "@/lib/db";
import { teamColorMap } from "@/lib/chart-theme";
import { tradeLedger, tradePartnerGrid } from "@/server/stats/trade-ledger";
import { TradeValueChart } from "@/components/trades/trade-value-chart";
import { TradeLedgerChart } from "@/components/trades/trade-ledger-chart";
import { TradePartnerGrid } from "@/components/trades/trade-partner-grid";

export const metadata = { title: "Trade Tribunal" };

const VERDICT_STYLE: Record<Lopsidedness, string> = {
  // Dark text on the loss red: light text was 2.7:1.
  HIGHWAY_ROBBERY: "bg-destructive text-background",
  FLEECED: "bg-primary text-primary-foreground",
  CLEAR_WINNER: "border border-primary/50 bg-primary/15 text-primary",
  SLIGHT_EDGE: "border border-border/60 bg-muted text-muted-foreground",
  EVEN_DEAL: "border border-border/60 bg-muted text-muted-foreground",
};

const CONFIDENCE_LABEL: Record<TradeTribunalView["confidence"], string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence",
  NONE: "Cannot be judged",
};

export default async function TradeTribunalPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  await renderAtRequestIfNoDatabase();
  const { show } = await searchParams;
  const showAll = show === "all";

  const all = await getTradeTribunal();
  const verdicts = await tradeVerdictTexts(all);
  const headline = all.filter(isHeadlineTrade);
  const quiet = all.filter((t) => !isHeadlineTrade(t));
  const trades = showAll ? all : headline;

  // One colour per manager, the same on every chart on the site.
  const colorMap = teamColorMap((await prisma.manager.findMany({ select: { id: true } })).map((m) => m.id));
  const colors = Object.fromEntries(colorMap);

  // The ledger and partner grid are over EVERY trade, not just the headline ones.
  const ledgerInput = all.map((t) => ({ sides: t.sides.map((s) => ({ managerId: s.managerId, value: s.value })) }));
  const ledger = tradeLedger(ledgerInput);
  const partnerCells = Object.fromEntries(tradePartnerGrid(ledgerInput));
  const names: Record<string, string> = {};
  for (const t of all) for (const s of t.sides) names[s.managerId] = s.managerName;
  const traders = Object.entries(names)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader art="header-trade-tribunal" freshness
        eyebrow="The Court"
        title="Trade Tribunal"
        description="Every trade in league history, judged on what each player was actually worth at his own position — not on who scored more points. The most one-sided deals are on top."
      />

      {/* League-wide: who profits from trading, and who keeps dialing whom. */}
      {ledger.length > 0 ? (
        <section className="mt-8 space-y-4" aria-labelledby="ledger-heading">
          <h2 id="ledger-heading" className="font-heading text-lg font-semibold tracking-wide uppercase">
            The books
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <TradeLedgerChart ledger={ledger} names={names} />
            <TradePartnerGrid managers={traders} cells={partnerCells} />
          </div>
        </section>
      ) : null}

      {/* Default view hides the deals nobody won. */}
      {quiet.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">
            {showAll
              ? `Showing all ${all.length} trades.`
              : `Showing the ${headline.length} trade${headline.length === 1 ? "" : "s"} someone actually won. ${quiet.length} even or near-even deal${quiet.length === 1 ? " is" : "s are"} in the archive.`}
          </span>
          <Link
            href={showAll ? "/trade-tribunal" : "/trade-tribunal?show=all"}
            className="font-medium text-primary hover:underline"
          >
            {showAll ? "Hide even deals" : "Show every trade"}
          </Link>
        </div>
      ) : null}

      <section className="mt-6" aria-label="Verdicts">
        {trades.length === 0 ? (
          <EmptyState
            icon={Gavel}
            title={all.length === 0 ? "No trades on record" : "No one-sided trades"}
            description={
              all.length === 0
                ? "Once managers start wheeling and dealing, every trade lands here for judgment."
                : "Every trade on record came out close to even. Use “Show every trade” above to see them all."
            }
          />
        ) : (
          /* One line per trade, most one-sided first; tap a line for the full ruling. */
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card/40">
            {trades.map((t) => (
              <li key={t.transactionId}>
                <TradeItem t={t} verdict={verdicts.get(t.transactionId)} colors={colors} />
              </li>
            ))}
          </ul>
        )}

        {/*
          Methodology. It used to sit up front, ahead of every verdict, and
          pushed the list a full screen down on a phone; it is the same text,
          one tap away at the foot of the verdicts.
        */}
        <details className="group mt-6 rounded-lg border border-border/60 bg-card/40">
          <summary className={DISCLOSURE_SUMMARY_CLASS}>
            <span className="min-w-0 flex-1 font-heading text-base font-semibold">How it&rsquo;s calculated</span>
            <DisclosureChevron />
          </summary>
          <div className="px-3 pb-4 sm:px-4">
            <p className="mt-1 max-w-prose text-sm leading-relaxed text-muted-foreground">
              Raw points cannot settle a trade. A mid-range quarterback outscores an elite tight end
              and is worth far less, because the next quarterback off the waiver wire also outscores
              that tight end. So every acquired player is converted into one number that means the
              same thing at every position: how much better than freely available he was, for as long
              as he was available.
            </p>
            <dl className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="inline font-medium text-foreground">Replacement level — </dt>
                <dd className="inline">
                  the points per game of the last player at that position who would still be starting
                  somewhere in a ten-team league. Only production above that line counts.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Availability — </dt>
                <dd className="inline">
                  value is banked per game actually played after the trade, so an injury reduces it by
                  counting rather than by an estimated discount.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Positional scarcity — </dt>
                <dd className="inline">
                  how steep the drop-off is at that position. A point above replacement is worth more
                  where the good players are further clear of the replaceable ones.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Playoff weeks — </dt>
                <dd className="inline">
                  postseason production is counted a second time at half weight. Winning the title is
                  the point.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Consolidation — </dt>
                <dd className="inline">
                  turning two roster spots into one better player frees a spot; a small capped credit
                  reflects that.
                </dd>
              </div>
              <div>
                <dt className="inline font-medium text-foreground">Draft picks and FAAB — </dt>
                <dd className="inline">
                  have no market price on record, so they are named but never given an invented value,
                  and the trade&rsquo;s confidence is lowered.
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">
              The margin is then graded on both an absolute and a relative test:{" "}
              <strong className="text-foreground">Highway Robbery</strong>,{" "}
              <strong className="text-foreground">Fleeced</strong>,{" "}
              <strong className="text-foreground">Clear Winner</strong>,{" "}
              <strong className="text-foreground">Slight Edge</strong>, or an{" "}
              <strong className="text-foreground">Even Deal</strong>. Both tests must pass, so two
              quiet hauls where one doubled the other are not called a robbery.
            </p>
          </div>
        </details>
      </section>
    </div>
  );
}

function TradeItem({
  t,
  verdict,
  colors,
}: {
  t: TradeTribunalView;
  verdict?: RenderedText;
  colors: Record<string, string>;
}) {
  // A cached view from before the timeline existed has none; treat it as empty.
  const timeline = t.timeline ?? [];
  const decisive =
    t.lopsidedness === "HIGHWAY_ROBBERY" ||
    t.lopsidedness === "FLEECED" ||
    t.lopsidedness === "CLEAR_WINNER";

  /*
   * The winner's share of all the value that changed hands. This replaces a
   * multiple of the AVERAGE haul, which is exactly 2.0× whenever the losing
   * side banked nothing — the most common one-sided trade — so it said the
   * same thing on every card. Values are floored at zero, so the share is a
   * true percentage. Never rounded up to 100% while the other side got any.
   */
  const total = t.sides.reduce((sum, s) => sum + s.value, 0);
  const winnerValue = t.sides.find((s) => s.managerId === t.winnerManagerId)?.value;
  const winnerShare =
    t.sides.length === 2 && winnerValue != null && total > 0
      ? Math.min(winnerValue === total ? 100 : 99, Math.round((winnerValue / total) * 100))
      : null;

  const verdictBadge = t.lopsidedness ? (
    <Badge className={VERDICT_STYLE[t.lopsidedness]}>{LOPSIDEDNESS_LABEL[t.lopsidedness]}</Badge>
  ) : (
    <Badge variant="outline" className="border-dashed">
      Not graded
    </Badge>
  );

  return (
    <details className={`group ${decisive ? "border-l-2 border-l-primary/60" : ""}`}>
      {/* The compact line: when, who, and the ruling. */}
      <summary className={cn(DISCLOSURE_SUMMARY_CLASS, "rounded-none focus-visible:ring-inset")}>
        <span className="grid min-w-0 flex-1 grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 sm:grid-cols-[6.5rem_1fr_auto]">
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {t.seasonYear}
            {t.week != null ? ` · Wk ${t.week}` : ""}
          </span>
          <span className="justify-self-end sm:order-last">{verdictBadge}</span>
          <span className="col-span-2 min-w-0 truncate font-medium sm:col-span-1">
            {t.sides.map((s) => s.managerName).join(" ↔ ")}
          </span>
        </span>
        <DisclosureChevron />
      </summary>
      <div className="space-y-4 border-t border-border/60 bg-background/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {verdictBadge}
            {t.notable ? <Badge variant="secondary">Notable</Badge> : null}
            {t.provisional ? (
              <Badge variant="outline" className="border-primary/50 text-primary">
                Provisional — re-scored weekly until the {t.seasonYear} championship
              </Badge>
            ) : null}
            <Badge variant="outline" className="text-muted-foreground">
              {CONFIDENCE_LABEL[t.confidence]}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {t.seasonYear}
              {t.week != null ? ` · Week ${t.week}` : ""}
            </span>
          </div>
          {t.differential != null && t.lopsidedness !== "EVEN_DEAL" ? (
            <div className="text-right">
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Value differential
              </p>
              {/* One decimal, matching the verdict prose (+41 above a verdict
                  that says 41.2 read as two different numbers). Body face with
                  tabular figures, like every other value on the card. */}
              <p className="text-lg font-semibold tabular-nums text-primary">
                +{t.differential.toFixed(1)}
              </p>
              <p className="text-xs text-muted-foreground">
                position-adjusted points above replacement
                {winnerShare != null
                  ? ` · ${t.winnerName ?? "the winner"} got ${winnerShare}% of the value in the deal`
                  : ""}
              </p>
            </div>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {t.sides.map((side) => (
            <div
              key={side.managerId}
              className={`rounded-lg border p-3 ${
                t.winnerManagerId === side.managerId
                  ? "border-primary/50 bg-primary/5"
                  : "border-border/60 bg-card/30"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={managerPath(side.managerName)}
                  className="font-heading text-base font-semibold hover:text-primary"
                >
                  {side.managerName}
                </Link>
                <span className="text-right">
                  <span className="block text-[11px] tracking-wide text-muted-foreground uppercase">
                    Value received
                  </span>
                  {/* Not Geist Mono: its slashed zero made a 0 look like a
                      different kind of value from every other figure. */}
                  <span
                    className="block text-sm tabular-nums text-foreground"
                    title="Position-adjusted points above replacement, banked per game actually played"
                  >
                    {side.value.toFixed(1)}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <ArrowRight className="h-3 w-3" aria-hidden />
                <span>acquired</span>
              </div>
              <ul className="mt-1 space-y-1 text-sm text-foreground/90">
                {side.players.length === 0 && side.unpricedAssets.length === 0 ? (
                  <li className="text-muted-foreground">nothing on record</li>
                ) : null}
                {side.players.map((p) => (
                  <li key={p.playerId}>
                    <span className="font-medium">
                      {p.name} ({positionLabel(p.position)})
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {p.note
                        ? p.note
                        : `${p.pointsPerGame?.toFixed(1)} pts/gm, ${
                            p.ppgAboveReplacement != null
                              ? `${p.ppgAboveReplacement > 0 ? "+" : ""}${p.ppgAboveReplacement.toFixed(1)} vs replacement`
                              : "no replacement line"
                          }${
                            p.positionalPercentile != null
                              ? `, ${ordinal(p.positionalPercentile)} percentile at ${positionLabel(p.position)}`
                              : ""
                          }${p.availability != null ? `, played ${Math.round(p.availability * 100)}% of the remaining weeks` : ""}`}
                    </span>
                  </li>
                ))}
                {side.unpricedAssets.map((a) => (
                  <li key={a} className="text-muted-foreground">
                    {a} <span className="text-xs">— not valued</span>
                  </li>
                ))}
              </ul>
              {side.consolidationCredit > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  +{side.consolidationCredit} for consolidating roster spots
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <p className="text-sm text-foreground/90">
          <span className="font-medium">In hindsight: </span>
          {t.hindsightSummary}.
        </p>

        {verdict ? (
          <div className="border-l-2 border-primary/40 pl-3">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {t.provisional ? "Verdict so far" : "Verdict"}
            </p>
            <AiText text={verdict} paragraphClassName="italic" />
          </div>
        ) : null}

        {/*
          The lines every figure above is measured against. Without them "+41
          above replacement" is unfalsifiable: a reader cannot tell whether the
          bar was 6 points a game or 16. Per position, and for THIS season's
          window — replacement level is not a constant across years.
        */}
        {/* Collapsed: fourteen cards each carrying a chart is a long scroll on a phone. */}
        {timeline.length > 0 ? (
          <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Value over time (weeks {timeline[0].week}–{timeline.at(-1)?.week})
            </summary>
            <TradeValueChart timeline={timeline} sides={t.sides} colors={colors} />
          </details>
        ) : (
          <p className="text-xs text-muted-foreground">
            No weeks scored since the deal yet, so there is no value-over-time line to draw.
          </p>
        )}

        {t.benchmarks.length > 0 ? (
          <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Replacement level used for this trade ({t.seasonYear})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4 text-left font-medium">Position</th>
                    <th className="py-1 pr-4 text-right font-medium">Replacement</th>
                    <th className="py-1 pr-4 text-right font-medium">Scarcity</th>
                    <th className="py-1 text-right font-medium">Players</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {t.benchmarks.map((b) => (
                    <tr key={b.position}>
                      <td className="py-1 pr-4">{positionLabel(b.position)}</td>
                      <td className="py-1 pr-4 text-right tabular-nums">
                        {b.replacementPpg.toFixed(1)} pts/gm
                      </td>
                      <td className="py-1 pr-4 text-right tabular-nums">
                        {b.scarcity.toFixed(2)}×
                      </td>
                      <td className="py-1 text-right tabular-nums text-muted-foreground">
                        {b.sampleSize}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              <strong className="text-foreground">Replacement</strong> is the per-game scoring of the
              last player at that position who would still be starting somewhere in this league — the
              bar a trade has to clear to be worth anything.{" "}
              <strong className="text-foreground">Scarcity</strong> is how far the starters at that
              position sit above that bar; the higher it is, the more each point above replacement is
              worth. <strong className="text-foreground">Players</strong> is how many were on record
              to draw the line from, so a thin sample is visible rather than hidden.
            </p>
          </details>
        ) : null}

        {t.missingInputs.length > 0 ? (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{t.missingInputs.join("; ")}.</span>
          </p>
        ) : null}

        {t.notes ? <p className="text-xs text-muted-foreground">{t.notes}</p> : null}
      </div>
    </details>
  );
}
