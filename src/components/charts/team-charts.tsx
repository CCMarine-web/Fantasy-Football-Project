"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  usePlotArea,
  useYAxisScale,
} from "recharts";
import { AXIS_PROPS, RESULT_COLORS, TOOLTIP_STYLE } from "@/lib/chart-theme";
import { niceTicks } from "@/lib/chart-ticks";

/**
 * Team charts that identify teams by DIRECT LABEL, not by ten arbitrary
 * colours (the Nov 2026 audit found two yellows, two oranges and two light
 * blues). One accent for the team in focus, neutral ink for the rest.
 *
 * Win/loss green and red are not separable for deuteranopes on their own
 * (ΔE 5.8), so every use carries a second cue: direction from zero and a signed
 * label (luck ledger), or filled vs outlined bars (wins vs losses).
 */

const ACCENT = "var(--primary)";
const INK = "var(--foreground)";
const MUTED = "var(--muted-foreground)";

function signed(v: number, digits = 1): string {
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

// ── 1. Diverging bars (luck ledger, points left on the bench) ───────────────

export interface LedgerDatum {
  label: string;
  value: number;
  /** Tooltip / table detail. */
  detail?: string;
}

export function DivergingBars({
  data,
  valueLabel,
  unit = "",
  digits = 1,
  oneSided,
}: {
  data: LedgerDatum[];
  valueLabel: string;
  unit?: string;
  digits?: number;
  /** All values share a sign (e.g. points left on the bench): one neutral colour. */
  oneSided?: boolean;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((d) => Math.abs(d.value)));
  const ticks = niceTicks(oneSided ? 0 : -max, max, 5);
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, sorted.length * 30 + 40)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 44, left: 4, bottom: 18 }} barCategoryGap={6}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          domain={[ticks[0], ticks.at(-1) as number]}
          ticks={ticks}
          {...AXIS_PROPS}
          tickFormatter={(v: number) => (oneSided ? v.toFixed(0) : signed(v, 0))}
          label={{ value: valueLabel, position: "insideBottom", offset: -8, fill: MUTED, fontSize: 11 }}
        />
        <YAxis type="category" dataKey="label" {...AXIS_PROPS} width={92} interval={0} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(v) => [`${typeof v === "number" ? (oneSided ? v.toFixed(digits) : signed(v, digits)) : v}${unit}`, valueLabel]}
          labelFormatter={(label, payload) => {
            const d = payload?.[0]?.payload as LedgerDatum | undefined;
            return d?.detail ? `${label} · ${d.detail}` : String(label);
          }}
        />
        <ReferenceLine x={0} stroke={MUTED} />
        <Bar dataKey="value" isAnimationActive={false} radius={4}>
          {sorted.map((d) => (
            <Cell key={d.label} fill={oneSided ? ACCENT : d.value >= 0 ? RESULT_COLORS.win : RESULT_COLORS.loss} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            fontSize={11}
            fill={INK}
            formatter={(v: unknown) => (typeof v === "number" ? (oneSided ? v.toFixed(digits) : signed(v, digits)) : "")}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── 2. Weekly score vs league average, by result ────────────────────────────

export interface ResultBarDatum {
  label: string;
  /** Team score minus the league mean that week. */
  value: number;
  result: "W" | "L" | "T";
  detail: string;
}

export function ResultBars({ data }: { data: ResultBarDatum[] }) {
  const max = Math.max(5, ...data.map((d) => Math.abs(d.value)));
  const ticks = niceTicks(-max, max, 5);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 18 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} interval={0} label={{ value: "Week", position: "insideBottom", offset: -10, fill: MUTED, fontSize: 11 }} />
        <YAxis
          {...AXIS_PROPS}
          width={40}
          domain={[ticks[0], ticks.at(-1) as number]}
          ticks={ticks}
          tickFormatter={(v: number) => signed(v, 0)}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          content={({ payload }) => {
            const d = payload?.[0]?.payload as ResultBarDatum | undefined;
            if (!d) return null;
            return (
              <div style={TOOLTIP_STYLE} className="px-2 py-1">
                <div className="font-semibold">Week {d.label}</div>
                <div>{signed(d.value)} vs league average</div>
                <div className="text-muted-foreground">{d.detail}</div>
              </div>
            );
          }}
        />
        <ReferenceLine y={0} stroke={MUTED} />
        <Bar dataKey="value" isAnimationActive={false} radius={4}>
          {data.map((d) => {
            const color = d.result === "W" ? RESULT_COLORS.win : d.result === "L" ? RESULT_COLORS.loss : RESULT_COLORS.neutral;
            // Wins filled, losses outlined: the result never rests on hue alone.
            return (
              <Cell
                key={d.label}
                fill={d.result === "W" ? color : "transparent"}
                stroke={color}
                strokeWidth={d.result === "W" ? 0 : 2}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── 3. Scoring range: a dot per week, a tick at the median ──────────────────

export interface RangeRow {
  label: string;
  scores: { week: number; score: number }[];
  median: number;
}

export function RangeDots({ rows, leagueMedian }: { rows: RangeRow[]; leagueMedian: number }) {
  const sorted = [...rows].sort((a, b) => b.median - a.median);
  const labels = sorted.map((r) => r.label);
  const dots = sorted.flatMap((r, i) => r.scores.map((s) => ({ x: s.score, y: i, team: r.label, week: s.week, kind: "week" as const })));
  const medians = sorted.map((r, i) => ({ x: r.median, y: i, team: r.label, week: 0, kind: "median" as const }));
  const all = dots.map((d) => d.x);
  const ticks = niceTicks(Math.min(...all), Math.max(...all), 6);
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 32 + 48)}>
      <ScatterChart margin={{ top: 24, right: 12, left: 4, bottom: 18 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          dataKey="x"
          domain={[ticks[0], ticks.at(-1) as number]}
          ticks={ticks}
          {...AXIS_PROPS}
          label={{ value: "Points scored in a week", position: "insideBottom", offset: -10, fill: MUTED, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          domain={[-0.5, sorted.length - 0.5]}
          ticks={sorted.map((_, i) => i)}
          reversed
          interval={0}
          tickFormatter={(i: number) => labels[i] ?? ""}
          {...AXIS_PROPS}
          width={92}
        />
        <ZAxis range={[60, 60]} />
        <ReferenceLine x={leagueMedian} stroke={MUTED} strokeDasharray="4 4" label={{ value: "League median", position: "top", fill: MUTED, fontSize: 10 }} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          content={({ payload }) => {
            const d = payload?.[0]?.payload as (typeof dots)[number] | (typeof medians)[number] | undefined;
            if (!d) return null;
            return (
              <div style={TOOLTIP_STYLE} className="px-2 py-1">
                <div className="font-semibold">{d.team}</div>
                <div>{d.kind === "median" ? `Median ${d.x.toFixed(1)}` : `Week ${d.week}: ${d.x.toFixed(1)}`}</div>
              </div>
            );
          }}
        />
        <Scatter data={dots} isAnimationActive={false} fill={MUTED} fillOpacity={0.7} />
        <Scatter
          data={medians}
          isAnimationActive={false}
          shape={(p: { cx?: number; cy?: number }) => (
            <rect x={(p.cx ?? 0) - 1.5} y={(p.cy ?? 0) - 9} width={3} height={18} rx={1.5} fill={ACCENT} />
          )}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

// ── 4. Lines with direct end labels and tap-to-highlight ────────────────────

export interface TeamLine {
  key: string;
  label: string;
}

/** Spreads labels so none overlap (min gap in px), keeping their order. */
export function spreadLabels(ys: { key: string; y: number }[], minGap: number, top: number, bottom: number) {
  const sorted = [...ys].sort((a, b) => a.y - b.y).map((d) => ({ ...d }));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < minGap) sorted[i].y = sorted[i - 1].y + minGap;
  }
  const overflow = sorted.length ? sorted[sorted.length - 1].y - bottom : 0;
  if (overflow > 0) {
    sorted[sorted.length - 1].y -= overflow;
    for (let i = sorted.length - 2; i >= 0; i -= 1) {
      if (sorted[i + 1].y - sorted[i].y < minGap) sorted[i].y = sorted[i + 1].y - minGap;
    }
  }
  return sorted.map((d) => ({ ...d, y: Math.max(top, d.y) }));
}

function EndLabels({
  series,
  last,
  focus,
  emphasised,
  onPick,
}: {
  series: TeamLine[];
  last: Record<string, number | null>;
  focus: string | null;
  emphasised: Set<string>;
  onPick: (key: string) => void;
}) {
  const area = usePlotArea();
  const yScale = useYAxisScale();
  if (!area || !yScale) return null;
  const points = series
    .filter((s) => last[s.key] != null)
    .map((s) => ({ key: s.key, y: Number(yScale(last[s.key] as number)) }))
    .filter((p) => Number.isFinite(p.y));
  const placed = spreadLabels(points, 12, area.y, area.y + area.height);
  const x = area.x + area.width + 6;
  return (
    <g>
      {placed.map((p) => {
        const s = series.find((x) => x.key === p.key) as TeamLine;
        const on = focus ? focus === p.key : emphasised.has(p.key);
        return (
          <text
            key={p.key}
            x={x}
            y={p.y}
            dy="0.35em"
            fontSize={11}
            fill={focus === p.key ? ACCENT : on ? INK : MUTED}
            fontWeight={focus === p.key ? 600 : 400}
            style={{ cursor: "pointer" }}
            onClick={() => onPick(p.key)}
          >
            {s.label}
          </text>
        );
      })}
    </g>
  );
}

export function HighlightLines({
  data,
  xKey,
  series,
  xLabel,
  yLabel,
  yDomain,
  yTicks,
  reversedY,
  yFormat = "number",
  defaultEmphasis = [],
  height = 288,
}: {
  data: Record<string, number | string | null>[];
  xKey: string;
  series: TeamLine[];
  xLabel: string;
  yLabel: string;
  yDomain: [number, number];
  yTicks?: number[];
  reversedY?: boolean;
  yFormat?: "number" | "pct" | "ordinal";
  /** Keys drawn in full ink before anyone taps (e.g. the top six). */
  defaultEmphasis?: string[];
  /** Plot height in px; the tap chips sit below it, outside this height. */
  height?: number;
}) {
  const [focus, setFocus] = useState<string | null>(null);
  const emphasised = new Set(defaultEmphasis);
  const fmt = (v: number) =>
    yFormat === "pct" ? `${v.toFixed(0)}%` : yFormat === "ordinal" ? `#${v}` : String(v);
  const last: Record<string, number | null> = {};
  for (const s of series) {
    let v: number | null = null;
    for (const row of data) if (typeof row[s.key] === "number") v = row[s.key] as number;
    last[s.key] = v;
  }
  const pick = (key: string) => setFocus((f) => (f === key ? null : key));
  const strokeOf = (key: string) => (focus ? (focus === key ? ACCENT : MUTED) : emphasised.has(key) || emphasised.size === 0 ? INK : MUTED);
  const opacityOf = (key: string) => (focus ? (focus === key ? 1 : 0.25) : emphasised.size === 0 || emphasised.has(key) ? 0.85 : 0.3);
  // Draw the focused/emphasised lines last so they sit on top.
  const order = [...series].sort((a, b) => Number(a.key === focus || emphasised.has(a.key)) - Number(b.key === focus || emphasised.has(b.key)));
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 112, left: 0, bottom: 18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} {...AXIS_PROPS} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: MUTED, fontSize: 11 }} />
          <YAxis
            {...AXIS_PROPS}
            reversed={reversedY}
            domain={yDomain}
            ticks={yTicks}
            interval={0}
            width={40}
            tickFormatter={fmt}
            aria-label={yLabel}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [typeof v === "number" ? fmt(v) : String(v ?? "—"), String(name)]}
            itemSorter={(item) => (reversedY ? Number(item.value) : -Number(item.value))}
          />
          {order.map((s) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={strokeOf(s.key)}
              strokeOpacity={opacityOf(s.key)}
              strokeWidth={focus === s.key ? 3 : 2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
              onClick={() => pick(s.key)}
              style={{ cursor: "pointer" }}
            />
          ))}
          <EndLabels series={series} last={last} focus={focus} emphasised={emphasised} onPick={pick} />
        </LineChart>
      </ResponsiveContainer>
      {/* Tap targets for touch screens: the same highlight as tapping a line. */}
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Highlight a team">
        {series.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => pick(s.key)}
            aria-pressed={focus === s.key}
            className={`min-h-11 rounded-full border px-3 text-xs ${focus === s.key ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
