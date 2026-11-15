import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { AiText } from "@/components/shared/ai-text";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { heatColor } from "@/lib/chart-theme";
import { ordinal } from "@/lib/format";
import { formatLuckWins } from "@/server/stats/luck-wins";
import type { PowerRankingView } from "@/server/repositories/power-rankings-repository";
import type { RankedLuck } from "@/server/repositories/luck-repository";
import type { RenderedText } from "@/server/text/read";

/**
 * The power-rankings heat grid: teams × factors.
 *
 * Header and rows are built from ONE column list, so a header can never drift
 * off its cells. (The Nov 2026 audit found every header shifted one column: the
 * header's screen-reader-only "Move" cell was absolutely positioned, which takes
 * it out of the CSS grid.)
 */

export interface GridWeight {
  key: string;
  label: string;
  description: string;
  weight: number;
}

export function gridTemplate(factorCount: number): string {
  return `2rem 2.25rem minmax(15rem, 2.6fr) 4rem repeat(${factorCount}, minmax(4.25rem, 1fr))`;
}

function Movement({ rank, previous }: { rank: number; previous: number | null }) {
  if (previous == null) return <span className="text-xs text-muted-foreground">—</span>;
  const diff = previous - rank;
  if (diff === 0)
    return (
      <span className="flex items-center text-xs text-muted-foreground" title="No change from last week" aria-label="no change">
        <Minus className="h-3 w-3" aria-hidden />
      </span>
    );
  const up = diff > 0;
  return (
    <span
      className={`flex items-center text-xs font-semibold ${up ? "text-field" : "text-destructive"}`}
      title={`${up ? "Up" : "Down"} ${Math.abs(diff)} from ${ordinal(previous)} last week`}
      aria-label={`${up ? "up" : "down"} ${Math.abs(diff)}`}
    >
      {up ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {Math.abs(diff)}
    </span>
  );
}

export function PowerGrid({
  rows,
  weights,
  percents,
  luck,
  blurbs,
}: {
  rows: PowerRankingView[];
  weights: GridWeight[];
  percents: number[];
  luck: Record<string, RankedLuck>;
  blurbs: Record<string, RenderedText>;
}) {
  const template = gridTemplate(weights.length);
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border/60 bg-card" role="region" aria-label="Power rankings by factor, scrolls sideways" tabIndex={0}>
      <div className="min-w-[1000px]">
        <div
          data-testid="power-grid-header"
          className="grid items-center gap-px border-b border-border/60 px-2 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase"
          style={{ gridTemplateColumns: template }}
        >
          <span>#</span>
          {/* A real grid cell (not sr-only), so the columns stay aligned. */}
          <span>
            <span className="sr-only">Movement since last week</span>
          </span>
          <span>Team</span>
          <span className="text-right">Score</span>
          {weights.map((w, i) => (
            <span key={w.key} className="px-1 text-center leading-tight" title={`${w.label} — ${w.description} Weight ${percents[i]}%.`}>
              {w.label}
              <span className="block font-normal normal-case">{percents[i]}%</span>
            </span>
          ))}
        </div>
        {rows.map((row) => {
          const l = row.managerId ? luck[row.managerId] : undefined;
          return (
            <details key={row.fantasyTeamId} className="group border-b border-border/40 last:border-b-0">
              <summary
                data-testid="power-grid-row"
                className="grid min-h-11 cursor-pointer list-none items-center gap-px px-2 py-2 hover:bg-accent/30 [&::-webkit-details-marker]:hidden"
                style={{ gridTemplateColumns: template }}
              >
                <span className="font-mono text-sm text-muted-foreground">{row.rank}</span>
                <Movement rank={row.rank} previous={row.previousRank} />
                <span className="flex min-w-0 items-center gap-2">
                  <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{row.teamName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.managerName} · {row.record}
                      {l && l.tone !== "insufficient" ? (
                        <span title={`Luck: ${l.label} — ${l.wins} wins vs ${l.expected.toFixed(1)} expected`}>
                          {" "}
                          · luck {formatLuckWins(l.luckWins).replace(" wins", "")}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </span>
                <span className="text-right font-mono text-lg font-semibold tabular-nums text-primary">{row.score.toFixed(1)}</span>
                {weights.map((w) => {
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
                {blurbs[row.fantasyTeamId] ? <AiText text={blurbs[row.fantasyTeamId]} /> : null}
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
          );
        })}
      </div>
    </div>
  );
}
