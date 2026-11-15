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
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS_PROPS} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }} />
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
  const pad = (lo: number, hi: number) => {
    const d = (hi - lo) * 0.08 || 1;
    return [lo - d, hi + d] as [number, number];
  };
  const [x0, x1] = pad(minX, maxX);
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart margin={{ top: 12, right: 16, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis type="number" dataKey="x" domain={[x0, x1]} {...AXIS_PROPS} tickFormatter={xFormatter} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[y0, y1]} {...AXIS_PROPS} width={44} tickFormatter={yFormatter} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11, dx: 6 }} />
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
        <Scatter data={points} isAnimationActive={false}>
          {points.map((p) => (
            <Cell key={p.label} fill={p.color} />
          ))}
          <LabelList dataKey="label" position="top" fontSize={10} fill="var(--foreground)" />
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
}) {
  const fmt = fmtWith(valueFormat, (v: number) => v.toFixed(1));
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
            <XAxis dataKey="label" {...AXIS_PROPS} interval={0} label={categoryLabel ? { value: categoryLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 } : undefined} />
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
            <Cell key={d.label} fill={d.color ?? (diverging ? (d.value >= 0 ? "#3DD68C" : "#FF6369") : "var(--primary)")} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── One-axis strip plot (all of a week's scores) ───────────────────────────

export interface StripPoint {
  value: number;
  label: string;
  color: string;
  marker?: string;
}

export function StripPlot({ points, xLabel }: { points: StripPoint[]; xLabel: string }) {
  const data = points.map((p, i) => ({ ...p, x: p.value, y: (i % 3) - 1 }));
  const xs = points.map((p) => p.value);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 22, right: 16, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical horizontal={false} />
        <XAxis type="number" dataKey="x" domain={[Math.floor(Math.min(...xs) / 10) * 10 - 5, Math.ceil(Math.max(...xs) / 10) * 10 + 5]} {...AXIS_PROPS} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }} />
        <YAxis type="number" dataKey="y" domain={[-2, 2]} hide />
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
            <Cell key={p.label} fill={p.color} stroke={p.marker ? "var(--foreground)" : "none"} strokeWidth={p.marker ? 2 : 0} />
          ))}
          <LabelList dataKey="marker" position="top" fontSize={10} fill="var(--foreground)" />
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
