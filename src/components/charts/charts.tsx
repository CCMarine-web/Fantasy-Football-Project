"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
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
  ComposedChart,
} from "recharts";
import { AXIS_PROPS, TOOLTIP_STYLE } from "@/lib/chart-theme";
import { niceTicks } from "@/lib/chart-ticks";

/**
 * Named number formats. Server pages pass these strings (functions can't
 * cross the server/client boundary).
 */
export type NumberFormat = "fixed0" | "fixed1" | "pct0" | "ordinal" | "rank";
function fmtWith(f: NumberFormat | undefined, fallback: (v: number) => string): (v: number) => string {
  switch (f) {
    case "fixed0":
      return (v) => v.toFixed(0);
    case "fixed1":
      return (v) => v.toFixed(1);
    case "pct0":
      return (v) => `${v.toFixed(0)}%`;
    case "rank":
      return (v) => `#${v}`;
    case "ordinal":
      return (v) => {
        const m = v % 100;
        return m >= 11 && m <= 13 ? `${v}th` : `${v}${["th", "st", "nd", "rd"][v % 10] ?? "th"}`;
      };
    default:
      return fallback;
  }
}

/**
 * The site's chart components — one library (Recharts), one look. Server
 * pages compute the data; these only draw it. All share the axis, grid and
 * tooltip styles in lib/chart-theme.ts.
 */

// ── Multi-series line chart ────────────────────────────────────────────────

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  /** Points to mark specially (e.g. title years), by x value. */
  highlight?: { x: number | string; color: string; label: string }[];
}

export function MultiLineChart({
  data,
  xKey,
  series,
  xLabel,
  yLabel,
  reversedY,
  yDomain,
  yTicks,
  yFormat,
  tooltipFormat,
  legend = true,
  linear = true,
  xTickLabels,
}: {
  data: Record<string, number | string | boolean | null>[];
  xKey: string;
  series: LineSeries[];
  xLabel: string;
  yLabel: string;
  reversedY?: boolean;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  yTicks?: number[];
  yFormat?: NumberFormat;
  tooltipFormat?: NumberFormat;
  legend?: boolean;
  linear?: boolean;
  /** Only these x values get a tick, shown as the mapped text (e.g. one per season). */
  xTickLabels?: Record<string, string>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey={xKey}
          {...AXIS_PROPS}
          {...(xTickLabels ? { ticks: Object.keys(xTickLabels), interval: 0, tickFormatter: (v: string) => xTickLabels[v] ?? "" } : {})}
          label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          {...AXIS_PROPS}
          reversed={reversedY}
          domain={yDomain ?? ["auto", "auto"]}
          ticks={yTicks}
          interval={0}
          allowDecimals={false}
          width={40}
          tickFormatter={yFormat ? fmtWith(yFormat, String) : undefined}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11, dx: 6 }}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v, name) => [tooltipFormat && typeof v === "number" ? fmtWith(tooltipFormat, String)(v) : String(v ?? "—"), String(name)]}
          itemSorter={(item) => (reversedY ? Number(item.value) : -Number(item.value))}
        />
        {legend ? <Legend wrapperStyle={{ fontSize: 11, paddingTop: 22 }} /> : null}
        {series.map((s) => (
          <Line
            key={s.key}
            type={linear ? "linear" : "monotone"}
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            connectNulls
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; payload?: Record<string, unknown>; index?: number }) => {
              const hl = s.highlight?.find((h) => props.payload && h.x === props.payload[xKey]);
              if (props.cx == null || props.cy == null) return <g key={`${s.key}-${props.index}`} />;
              return hl ? (
                <circle key={`${s.key}-${props.index}`} cx={props.cx} cy={props.cy} r={6} fill={hl.color} stroke="var(--background)" strokeWidth={1.5}>
                  <title>{hl.label}</title>
                </circle>
              ) : (
                <circle key={`${s.key}-${props.index}`} cx={props.cx} cy={props.cy} r={3} fill={s.color} />
              );
            }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Scatter with labels, optional trend line and quadrant lines ────────────

export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  color: string;
  detail?: string;
}

export function LabeledScatter({
  points,
  xLabel,
  yLabel,
  xFormat,
  yFormat,
  trend,
  quadrants,
  quadrantLabels,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat?: NumberFormat;
  yFormat?: NumberFormat;
  /** Least-squares trend line drawn across the x range. */
  trend?: boolean;
  /** Reference lines at these x and y values (e.g. league averages). */
  quadrants?: { x: number; y: number };
  /** Labels for the four quadrants: [top-left, top-right, bottom-left, bottom-right]. */
  quadrantLabels?: [string, string, string, string];
}) {
  const xFormatter = fmtWith(xFormat, (v) => v.toFixed(0));
  const yFormatter = fmtWith(yFormat, (v) => v.toFixed(0));
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  let trendSegment: { x: number; y: number }[] = [];
  if (trend && points.length >= 2) {
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
    const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
    const slope = sxx ? sxy / sxx : 0;
    trendSegment = [
      { x: minX, y: my + slope * (minX - mx) },
      { x: maxX, y: my + slope * (maxX - mx) },
    ];
  }
  // Round ticks, and extra room at the corners when quadrant labels sit there,
  // so no point label lands on them.
  const padFrac = quadrantLabels ? 0.18 : 0.06;
  const pad = (lo: number, hi: number) => {
    const d = (hi - lo) * padFrac || 1;
    return niceTicks(lo - d, hi + d, 5);
  };
  const xTicks = pad(minX, maxX);
  const yTicks = pad(Math.min(...ys), Math.max(...ys));
  const [x0, x1] = [xTicks[0], xTicks.at(-1) as number];
  const [y0, y1] = [yTicks[0], yTicks.at(-1) as number];
  // Label collisions: a label whose neighbour sits just above-left/right goes
  // below its dot instead.
  const below = new Set<string>();
  const nearX = (x1 - x0) * 0.12;
  const nearY = (y1 - y0) * 0.07;
  for (const p of points) {
    const clash = points.some((q) => q !== p && !below.has(q.label) && Math.abs(q.x - p.x) < nearX && q.y > p.y && q.y - p.y < nearY);
    if (clash) below.add(p.label);
  }
  const labelled = points.map((p) => ({ ...p, labelPos: below.has(p.label) ? "bottom" : "top" }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart margin={{ top: 12, right: 16, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" dataKey="x" domain={[x0, x1]} ticks={xTicks} interval={0} {...AXIS_PROPS} tickFormatter={xFormatter} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[y0, y1]} ticks={yTicks} interval={0} {...AXIS_PROPS} width={44} tickFormatter={yFormatter} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11, dx: 6 }} />
        <ZAxis range={[90, 90]} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ strokeDasharray: "3 3" }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as ScatterPoint | undefined;
            if (!p?.label) return null;
            return (
              <div style={TOOLTIP_STYLE} className="px-2 py-1">
                <div className="font-semibold">{p.label}</div>
                <div>
                  {xLabel}: {xFormatter(p.x)}
                </div>
                <div>
                  {yLabel}: {yFormatter(p.y)}
                </div>
                {p.detail ? <div className="text-muted-foreground">{p.detail}</div> : null}
              </div>
            );
          }}
        />
        {quadrants ? <ReferenceLine x={quadrants.x} stroke="var(--muted-foreground)" strokeDasharray="4 4" /> : null}
        {quadrants ? <ReferenceLine y={quadrants.y} stroke="var(--muted-foreground)" strokeDasharray="4 4" /> : null}
        {quadrantLabels && quadrants ? (
          <>
            <ReferenceLine x={x0} stroke="none" label={{ value: quadrantLabels[0], position: "insideTopLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
            <ReferenceLine x={x1} stroke="none" label={{ value: quadrantLabels[1], position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
            <ReferenceLine x={x0} stroke="none" label={{ value: quadrantLabels[2], position: "insideBottomLeft", fill: "var(--muted-foreground)", fontSize: 10 }} />
            <ReferenceLine x={x1} stroke="none" label={{ value: quadrantLabels[3], position: "insideBottomRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
          </>
        ) : null}
        {trendSegment.length ? (
          <Line data={trendSegment} dataKey="y" type="linear" stroke="var(--muted-foreground)" strokeDasharray="6 4" dot={false} isAnimationActive={false} legendType="none" name="Expected" />
        ) : null}
        <Scatter data={labelled} isAnimationActive={false}>
          {labelled.map((p) => (
            <Cell key={p.label} fill={p.color} />
          ))}
          <LabelList
            dataKey="label"
            content={(props: { x?: number | string; y?: number | string; width?: number | string; value?: unknown; index?: number }) => {
              const p = props.index != null ? labelled[props.index] : undefined;
              if (!p || props.x == null || props.y == null) return null;
              // x/y are the symbol box's corner: centre the label on the dot.
              const half = Number(props.width ?? 0) / 2;
              const x = Number(props.x) + half;
              const y = Number(props.y) + half;
              return (
                <text x={x} y={p.labelPos === "top" ? y - half - 4 : y + half + 12} textAnchor="middle" fontSize={10} fill="var(--foreground)">
                  {String(props.value ?? "")}
                </text>
              );
            }}
          />
        </Scatter>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Bars ───────────────────────────────────────────────────────────────────

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
  detail?: string;
  /** Second series (e.g. expected), drawn as a lighter bar. */
  value2?: number;
  /** Draw an outline (e.g. a championship-bracket game). */
  outline?: boolean;
}

export function SimpleBars({
  data,
  valueLabel,
  value2Label,
  horizontal,
  valueFormat,
  height,
  diverging,
  categoryLabel,
  categoryTicks,
}: {
  data: BarDatum[];
  valueLabel: string;
  value2Label?: string;
  horizontal?: boolean;
  valueFormat?: NumberFormat;
  height?: number;
  /** Colour positive/negative values differently around zero. */
  diverging?: boolean;
  categoryLabel?: string;
  /** Only these categories get a tick label, shown as the mapped text. */
  categoryTicks?: Record<string, string>;
}) {
  const fmt = fmtWith(valueFormat, (v: number) => v.toFixed(1));
  const sparse = categoryTicks ? { ticks: Object.keys(categoryTicks), tickFormatter: (v: string) => categoryTicks[v] ?? "" } : {};
  const hasSecond = data.some((d) => d.value2 != null);
  return (
    <ResponsiveContainer width="100%" height={height ?? "100%"}>
      <BarChart
        data={data}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 8, right: 28, left: 4, bottom: horizontal ? 8 : 18 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={!horizontal} vertical={!!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" {...AXIS_PROPS} tickFormatter={fmt} label={{ value: valueLabel, position: "insideBottom", offset: -4, fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis type="category" dataKey="label" {...AXIS_PROPS} width={104} interval={0} label={categoryLabel ? { value: categoryLabel, angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 } : undefined} />
          </>
        ) : (
          <>
            <XAxis dataKey="label" {...AXIS_PROPS} interval={0} {...sparse} label={categoryLabel ? { value: categoryLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 } : undefined} />
            <YAxis {...AXIS_PROPS} width={44} tickFormatter={fmt} label={{ value: valueLabel, angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11, dx: 6 }} />
          </>
        )}
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(v, name) => [typeof v === "number" ? fmt(v) : String(v), String(name)]}
        />
        {diverging ? <ReferenceLine {...(horizontal ? { x: 0 } : { y: 0 })} stroke="var(--muted-foreground)" /> : null}
        {hasSecond ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {hasSecond ? <Bar dataKey="value2" name={value2Label ?? "Expected"} fill="var(--muted-foreground)" opacity={0.45} isAnimationActive={false} /> : null}
        <Bar dataKey="value" name={valueLabel} isAnimationActive={false} radius={2}>
          {data.map((d) => (
            <Cell
              key={d.label}
              fill={d.color ?? (diverging ? (d.value >= 0 ? "#34C77B" : "#F0605D") : "var(--primary)")}
              stroke={d.outline ? "var(--foreground)" : undefined}
              strokeWidth={d.outline ? 2 : 0}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── One-axis strip plot (all of a week's scores) ───────────────────────────

export interface StripPoint {
  value: number;
  /** Full name, for the tooltip and table. */
  label: string;
  /** Short on-chart label (a surname). */
  tag?: string;
  color: string;
  /** Hollow marker (e.g. a loss): result never rests on colour alone. */
  hollow?: boolean;
  marker?: string;
}

/**
 * All of a week's scores on one axis. No jitter (the vertical position meant
 * nothing); each dot is labelled, alternating above and below in score order
 * so neighbours don't collide, with the week's average marked.
 */
export function StripPlot({ points, xLabel, average }: { points: StripPoint[]; xLabel: string; average?: number }) {
  const data = [...points]
    .sort((a, b) => a.value - b.value)
    .map((p, i) => ({ ...p, x: p.value, y: 0, above: i % 2 === 0 }));
  const xs = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(...xs) - 3, Math.max(...xs) + 3, 6);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 30, right: 24, left: 24, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical horizontal={false} />
        <XAxis type="number" dataKey="x" domain={[ticks[0], ticks.at(-1) as number]} ticks={ticks} interval={0} {...AXIS_PROPS} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[-1, 1]} hide />
        {average != null ? (
          <ReferenceLine x={average} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `Avg ${average.toFixed(1)}`, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }} />
        ) : null}
        <ZAxis range={[110, 110]} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as (StripPoint & { x: number }) | undefined;
            if (!p) return null;
            return (
              <div style={TOOLTIP_STYLE} className="px-2 py-1">
                <div className="font-semibold">{p.label}</div>
                <div>{p.value.toFixed(1)} pts</div>
                {p.marker ? <div>{p.marker}</div> : null}
              </div>
            );
          }}
        />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((p) => (
            <Cell
              key={p.label}
              fill={p.hollow ? "var(--card)" : p.color}
              stroke={p.marker ? "var(--foreground)" : p.color}
              strokeWidth={p.marker || p.hollow ? 2 : 0}
            />
          ))}
          <LabelList
            dataKey="tag"
            content={(props: { x?: number | string; y?: number | string; width?: number | string; index?: number }) => {
              const p = props.index != null ? data[props.index] : undefined;
              if (!p || props.x == null || props.y == null) return null;
              const cx = Number(props.x) + Number(props.width ?? 0) / 2;
              const cy = Number(props.y);
              const text = `${p.tag ?? ""}${p.marker ? ` · ${p.marker}` : ""}`;
              return (
                <text x={cx} y={p.above ? cy - 8 : cy + Number(props.width ?? 10) + 12} textAnchor="middle" fontSize={10} fill="var(--foreground)">
                  {text}
                </text>
              );
            }}
          />
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
