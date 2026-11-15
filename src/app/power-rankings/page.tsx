import { AiText } from "@/components/shared/ai-text";
import { powerBlurbTexts } from "@/server/text/page-texts";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { ChartFrame } from "@/components/charts/chart-frame";
import { LabeledScatter, MultiLineChart } from "@/components/charts/charts";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { getRankingHistory } from "@/server/pipeline/snapshots";
import { distributePercentages, ordinal } from "@/lib/format";
import { heatColor, teamColorMap } from "@/lib/chart-theme";
import { ArrowDown, ArrowUp, Info, Minus, TrendingUp } from "lucide-react";

export const metadata = { title: "Power Rankings" };

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

function Movement({ rank, previous }: { rank: number; previous: number | null }) {
  if (previous == null) return <span className="w-8 text-xs text-muted-foreground">—</span>;
  const diff = previous - rank;
  if (diff === 0)
    return (
      <span className="flex w-8 items-center text-xs text-muted-foreground" title="No change from last week">
        <Minus className="h-3 w-3" aria-hidden />
        <span className="sr-only">no change</span>
      </span>
    );
  const up = diff > 0;
  return (
    <span
      className={`flex w-8 items-center text-xs font-semibold ${up ? "text-field" : "text-destructive"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(diff)} from ${ordinal(previous)} last week`}
    >
      {up ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {Math.abs(diff)}
      <span className="sr-only">{up ? " up" : " down"}</span>
    </span>
  );
}

export default async function PowerRankingsPage() {
  const data = await getPowerRankings();

  if (!data || data.rows.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader art="header-power-rankings" freshness eyebrow="The Rat Trap" title="Power Rankings" />
        <div className="mt-8">
          <EmptyState
            icon={TrendingUp}
            title="Nothing to rank yet"
            description="Power rankings appear once the league has teams for a season. They update every week during the season."
          />
        </div>
      </div>
    );
  }

  const isInSeason = data.mode === "IN_SEASON";
  const isBaseline = data.mode === "MANAGER_BASELINE";
  const [blurbs, history] = await Promise.all([powerBlurbTexts(data), isInSeason ? getRankingHistory(data.seasonYear) : Promise.resolve([])]);
  const methodologyPercents = distributePercentages(data.weights.map((w) => w.weight));
  const colors = teamColorMap(data.rows.map((r) => r.managerId ?? r.fantasyTeamId));
  const colorOf = (r: (typeof data.rows)[number]) => colors.get(r.managerId ?? r.fantasyTeamId) ?? "var(--primary)";
  const title = isInSeason ? "Power Rankings" : isBaseline ? "Manager Baseline Rankings" : "Preseason Power Rankings";
  const updatedLabel = isInSeason
    ? `Updated through Week ${data.throughWeek}`
    : isBaseline
      ? `${data.seasonYear} preseason — before the draft`
      : `${data.seasonYear} preseason — after the draft, before Week 1`;
  const description = isInSeason
    ? `How good each team is right now, rebuilt every week from ${data.weeksCounted} week${data.weeksCounted === 1 ? "" : "s"} of results. Wins and losses are not an input — this rates team quality, not luck.`
    : isBaseline
      ? "The draft has not happened, so this ranks the managers on previous seasons, schedule luck removed."
      : "The draft is done and no week has been played, so this ranks the rosters just assembled.";

  // Rank-by-week chart data: one row per week, one key per team.
  const weeks = [...new Set(history.map((h) => h.week))].sort((a, b) => a - b);
  const lineData = weeks.map((w) => {
    const row: Record<string, number | string | null> = { week: `Wk ${w}` };
    for (const h of history.filter((x) => x.week === w)) row[h.fantasyTeamId] = h.rank;
    return row;
  });
  const n = data.rows.length;

  // Scatter: power score vs actual win %.
  const scatter = data.rows.map((r) => {
    const [w, l, t] = r.record.split("-").map(Number);
    const games = w + l + (t || 0);
    return {
      x: r.score,
      y: games ? ((w + 0.5 * (t || 0)) / games) * 100 : 0,
      label: r.teamName.length > 16 ? `${r.teamName.slice(0, 15)}…` : r.teamName,
      color: colorOf(r),
      detail: `${r.managerName} · ${r.record}`,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader art="header-power-rankings" freshness eyebrow={`${data.seasonYear} Season`} title={title} description={description} />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge className="bg-primary text-primary-foreground">{updatedLabel}</Badge>
        {isInSeason ? <Badge variant="outline">Regular-season games only</Badge> : null}
      </div>

      {isInSeason && lineData.length > 1 ? (
        <ChartFrame
          className="mt-6"
          title="Rank by week"
          caption="Where each team stood after every week. 1 is the top. Hover for the week's order."
          summary={`Power ranking of all ${n} teams after each of weeks ${weeks[0]} to ${weeks.at(-1)}.`}
          table={{ headers: ["Team", ...weeks.map((w) => `Week ${w}`)], rows: data.rows.map((r) => [r.teamName, ...weeks.map((w) => history.find((h) => h.week === w && h.fantasyTeamId === r.fantasyTeamId)?.rank ?? "—")]) }}
          height="h-80"
        >
          <MultiLineChart
            data={lineData}
            xKey="week"
            xLabel="Week"
            yLabel="Rank"
            reversedY
            yDomain={[1, n]}
            yTicks={Array.from({ length: n }, (_, i) => i + 1)}
            series={data.rows.map((r) => ({ key: r.fantasyTeamId, label: r.teamName, color: colorOf(r) }))}
            tooltipFormat="ordinal"
          />
        </ChartFrame>
      ) : null}

      {/* The grid: teams x factors, one row each. Click a row for the write-up. */}
      <section className="mt-8" aria-labelledby="pr-grid">
        <h2 id="pr-grid" className="mb-1 font-heading text-lg font-semibold tracking-wide uppercase">
          The rankings
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Cells are each factor&rsquo;s 0-100 score against the rest of the league (blue = strong, orange = weak); hover a cell for the raw stat. Tap a team for its write-up.
        </p>
        <div className="relative overflow-x-auto rounded-lg border border-border/60 bg-card" role="region" aria-label="Power rankings by factor, scrolls sideways" tabIndex={0}>
          <div className="min-w-[860px]">
            <div
              className="grid items-center gap-px border-b border-border/60 px-2 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
              style={{ gridTemplateColumns: `2rem 2rem minmax(10rem, 1.6fr) 4rem repeat(${data.weights.length}, minmax(4.25rem, 1fr))` }}
            >
              <span>#</span>
              <span className="sr-only">Move</span>
              <span>Team</span>
              <span className="text-right">Score</span>
              {data.weights.map((w, i) => (
                <span key={w.key} className="px-1 text-center leading-tight" title={`${w.label} — ${w.description} Weight ${methodologyPercents[i]}%.`}>
                  {w.label}
                  <span className="block font-normal normal-case">{methodologyPercents[i]}%</span>
                </span>
              ))}
            </div>
            {data.rows.map((row) => (
              <details key={row.fantasyTeamId} className="group border-b border-border/40 last:border-b-0">
                <summary
                  className="grid cursor-pointer list-none items-center gap-px px-2 py-2 hover:bg-accent/30 [&::-webkit-details-marker]:hidden"
                  style={{ gridTemplateColumns: `2rem 2rem minmax(10rem, 1.6fr) 4rem repeat(${data.weights.length}, minmax(4.25rem, 1fr))` }}
                >
                  <span className="font-mono text-sm text-muted-foreground">{row.rank}</span>
                  <Movement rank={row.rank} previous={row.previousRank} />
                  <span className="flex min-w-0 items-center gap-2">
                    <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-7 w-7 shrink-0" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{row.teamName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {row.managerName} · {row.record}
                      </span>
                    </span>
                  </span>
                  <span className="text-right font-heading text-lg font-semibold tabular-nums text-primary">{row.score.toFixed(1)}</span>
                  {data.weights.map((w) => {
                    const f = row.factors.find((x) => x.key === w.key);
                    return (
                      <span
                        key={w.key}
                        className="mx-0.5 rounded py-1.5 text-center font-mono text-xs tabular-nums text-foreground"
                        style={{ background: heatColor(f?.value) }}
                        title={f ? `${w.label}: ${f.raw} · factor score ${Math.round(f.value)}/100` : `${w.label}: not measured`}
                      >
                        {f ? Math.round(f.value) : "—"}
                      </span>
                    );
                  })}
                </summary>
                <div className="space-y-2 bg-muted/10 px-4 py-3">
                  {isInSeason ? <AiText text={blurbs.get(row.fantasyTeamId)} /> : null}
                  <ul className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                    {row.factors.map((f) => (
                      <li key={f.key}>
                        <span className="font-medium text-foreground">{f.label}:</span> {f.raw}{" "}
                        <span className="text-muted-foreground/80">(factor score {Math.round(f.value)}/100)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {isInSeason ? (
        <ChartFrame
          className="mt-8"
          title="Power score vs. win %"
          caption="Above the dashed line: winning more than the team's quality predicts (lucky or clutch). Below: better than the record says."
          summary="Scatter of each team's power score against its actual win percentage, with a least-squares trend line."
          table={{ headers: ["Team", "Power score", "Win %"], rows: scatter.map((s) => [s.label, s.x.toFixed(1), `${s.y.toFixed(0)}%`]) }}
          height="h-80"
        >
          <LabeledScatter points={scatter} xLabel="Power score" yLabel="Win %" yFormat="pct0" xFormat="fixed0" trend />
        </ChartFrame>
      ) : null}

      {/* Methodology, collapsed at the bottom. */}
      <details className="mt-8 rounded-lg border border-border/60 bg-card/40 p-4">
        <summary className="cursor-pointer font-heading text-base font-semibold">How the score is built</summary>
        <p className="mt-2 text-sm text-muted-foreground">
          Each factor is scored 0-100 relative to the rest of the league, then blended with the weights below.{" "}
          {isInSeason ? "Recent weeks carry more weight than early ones, but every week still counts." : "The model swaps to live results the moment Week 1 is final."}{" "}
          Win-loss record, championships and playoff finishes are deliberately <strong className="text-foreground">not</strong> inputs.
          A category with no data behind it is dropped and the remaining weights are rescaled.
        </p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {data.weights.map((m, i) => (
            <div key={m.key} className="flex gap-2">
              <dt className="w-10 shrink-0 font-mono text-sm font-semibold tabular-nums text-primary">{methodologyPercents[i]}%</dt>
              <dd className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{m.label}</span> — {m.description}
              </dd>
            </div>
          ))}
        </dl>
        {data.notes.map((note) => (
          <p key={note} className="mt-3 flex items-start gap-2 text-[13px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            {note}
          </p>
        ))}
      </details>
    </div>
  );
}
