import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart, SimpleBars } from "@/components/charts/charts";
import { positionColor, RESULT_COLORS } from "@/lib/chart-theme";
import { WINDOW_ORDER, type GameWindow } from "@/server/nfl-games";
import { lineupDecisions } from "@/server/stats/lineup-decisions";
import type { SeriesSummary } from "@/server/stats/head-to-head";

/**
 * The matchup page's analysis block: how the game unfolded across the NFL's
 * TV windows, the lineups head to head slot by slot, the decisions that cost
 * points, and the full history of the series.
 */

export interface BreakdownPlayer {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  slot: string;
  isStarter: boolean;
  points: number | null;
  projected: number | null;
}

export interface BreakdownSide {
  name: string;
  team: string;
  color: string;
  players: BreakdownPlayer[];
}

const SLOT_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "WRRB_FLEX", "REC_FLEX", "SUPER_FLEX", "K", "DEF"];
const slotRank = (s: string) => {
  const i = SLOT_ORDER.indexOf(s.toUpperCase());
  return i < 0 ? 99 : i;
};

function startersInSlotOrder(players: BreakdownPlayer[]) {
  return players
    .filter((p) => p.isStarter)
    .sort((a, b) => slotRank(a.slot) - slotRank(b.slot) || (b.points ?? 0) - (a.points ?? 0));
}

export function MatchupBreakdown({
  sides,
  windowOf,
  series,
  final,
}: {
  sides: [BreakdownSide, BreakdownSide];
  windowOf: (team: string | null) => GameWindow | null;
  series: SeriesSummary;
  final: boolean;
}) {
  const [a, b] = sides;
  const scored = a.players.some((p) => p.points != null) && b.players.some((p) => p.points != null);

  // ── Game flow: running totals by kickoff window.
  const windowsUsed = WINDOW_ORDER.filter((w) =>
    [...a.players, ...b.players].some((p) => p.isStarter && windowOf(p.nflTeam) === w),
  );
  const sumIn = (side: BreakdownSide, w: GameWindow) =>
    side.players.filter((p) => p.isStarter && windowOf(p.nflTeam) === w).reduce((s, p) => s + (p.points ?? 0), 0);
  const flow: { window: GameWindow; a: number; b: number }[] = [];
  for (const w of windowsUsed) {
    const prev = flow.at(-1) ?? { a: 0, b: 0 };
    flow.push({ window: w, a: Math.round((prev.a + sumIn(a, w)) * 10) / 10, b: Math.round((prev.b + sumIn(b, w)) * 10) / 10 });
  }

  // ── Slot by slot.
  const sa = startersInSlotOrder(a.players);
  const sb = startersInSlotOrder(b.players);
  const rows = Array.from({ length: Math.max(sa.length, sb.length) }, (_, i) => ({ a: sa[i], b: sb[i] }));
  const maxPts = Math.max(1, ...rows.flatMap((r) => [r.a?.points ?? 0, r.b?.points ?? 0]));

  // ── Decisions.
  const decisions = [a, b].map((side) =>
    scored
      ? lineupDecisions(
          side.players
            .filter((p) => p.points != null)
            .map((p) => ({ id: p.id, name: p.name, position: p.position, points: p.points as number, isStarter: p.isStarter, slot: p.slot })),
        )
      : null,
  );

  const margins = series.meetings.map((g) => ({
    label: `${String(g.season).slice(2)}·W${g.week}`,
    value: Math.round((g.pointsFor - g.pointsAgainst) * 10) / 10,
    color: g.isPlayoff ? "#F0E442" : g.pointsFor >= g.pointsAgainst ? a.color : b.color,
  }));

  return (
    <div className="space-y-6">
      {scored && flow.length > 1 ? (
        <ChartFrame
          title="Game flow"
          caption={`Running totals as each NFL window finished. ${final ? "Final" : "So far"}.`}
          summary={`Cumulative points for ${a.name} and ${b.name} after each NFL kickoff window.`}
          table={{ headers: ["Window", a.name, b.name], rows: flow.map((f) => [f.window, f.a, f.b]) }}
        >
          <MultiLineChart
            data={flow}
            xKey="window"
            xLabel="NFL window"
            yLabel="Points"
            series={[
              { key: "a", label: a.name, color: a.color },
              { key: "b", label: b.name, color: b.color },
            ]}
            tooltipFormat="fixed1"
          />
        </ChartFrame>
      ) : null}

      {rows.length > 0 ? (
        <figure className="rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4">
          <figcaption className="mb-3">
            <span className="block font-heading text-sm font-semibold tracking-wide uppercase">Slot by slot</span>
            <span className="block text-xs text-muted-foreground">
              Each starting slot head to head. Bars are coloured by position; the number in brackets is the projection.
            </span>
          </figcaption>
          <div className="space-y-1.5" role="table" aria-label="Starters compared slot by slot">
            <div className="grid grid-cols-[1fr_3rem_1fr] text-[11px] font-medium text-muted-foreground uppercase" role="row">
              <span className="truncate text-right" role="columnheader">{a.name}</span>
              <span className="text-center" role="columnheader">Slot</span>
              <span className="truncate" role="columnheader">{b.name}</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_3rem_1fr] items-center gap-1 text-xs" role="row">
                {[r.a, null, r.b].map((p, j) =>
                  j === 1 ? (
                    <span key="slot" className="text-center font-mono text-[11px] text-muted-foreground" role="cell">
                      {(r.a?.slot ?? r.b?.slot ?? "").replace("_FLEX", "")}
                    </span>
                  ) : (
                    <div key={j} className={`flex min-w-0 items-center gap-1.5 ${j === 0 ? "flex-row-reverse text-right" : ""}`} role="cell">
                      {p ? (
                        <>
                          <span
                            className="h-4 rounded-sm"
                            style={{ width: `${Math.max(2, ((p.points ?? 0) / maxPts) * 60)}%`, background: positionColor(p.position) }}
                            title={`${p.name} (${p.position}) ${p.points?.toFixed(1) ?? "—"} pts${p.projected != null ? `, projected ${p.projected.toFixed(1)}` : ""}`}
                          />
                          <span className="min-w-0 truncate">
                            <span className="font-medium">{p.name}</span>{" "}
                            <span className="font-mono tabular-nums">{p.points?.toFixed(1) ?? "—"}</span>
                            {p.projected != null ? <span className="text-muted-foreground"> ({p.projected.toFixed(1)})</span> : null}
                          </span>
                        </>
                      ) : null}
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {["QB", "RB", "WR", "TE", "K", "DEF"].map((pos) => (
              <span key={pos} className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: positionColor(pos) }} aria-hidden /> {pos}
              </span>
            ))}
          </div>
        </figure>
      ) : null}

      {decisions.some(Boolean) ? (
        <section className="grid gap-4 md:grid-cols-2" aria-label="Best possible lineup">
          {[a, b].map((side, i) => {
            const d = decisions[i];
            if (!d) return null;
            return (
              <div key={side.name} className="rounded-lg border border-border/60 bg-card/60 p-3 text-sm">
                <p className="font-heading text-sm font-semibold tracking-wide uppercase">{side.name}: best possible lineup</p>
                <p className="mt-1 text-muted-foreground">
                  Started <span className="font-mono text-foreground">{d.actual.toFixed(1)}</span> of a possible{" "}
                  <span className="font-mono text-foreground">{d.best.toFixed(1)}</span>
                  {d.leftOnBench > 0 ? ` — ${d.leftOnBench.toFixed(1)} left on the bench.` : " — a perfect lineup."}
                </p>
                {d.mistakes.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {d.mistakes.map((m) => (
                      <li key={m.started.id}>
                        Started <strong>{m.started.name}</strong> ({m.started.points.toFixed(1)}) over <strong>{m.benched.name}</strong> ({m.benched.points.toFixed(1)}):{" "}
                        <span className="font-mono" style={{ color: RESULT_COLORS.loss }}>
                          −{m.cost.toFixed(1)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}

      {margins.length > 0 ? (
        <ChartFrame
          title="Every meeting"
          caption={`Margin of each game from ${a.name}'s side; up = ${a.name} won. Yellow = championship-bracket game.`}
          summary={`Winning margin in each of the ${margins.length} meetings between ${a.name} and ${b.name}.`}
          table={{ headers: ["Meeting", `Margin (${a.name})`], rows: margins.map((m) => [m.label, m.value]) }}
          height="h-64"
        >
          <SimpleBars data={margins} valueLabel={`Margin (${a.name})`} diverging valueFormat="fixed0" />
        </ChartFrame>
      ) : null}
    </div>
  );
}
