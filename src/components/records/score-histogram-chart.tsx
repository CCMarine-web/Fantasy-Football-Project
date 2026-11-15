"use client";

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_PROPS, RESULT_COLORS, TOOLTIP_STYLE } from "@/lib/chart-theme";

export interface HistogramBin {
  /** e.g. "120" — the bin's lower edge, used as the axis tick. */
  label: string;
  from: number;
  to: number;
  count: number;
  /** "high" / "low" when the all-time record score falls in this bin. */
  mark?: "high" | "low" | null;
  /** Tooltip line for a marked bin, e.g. "Record high: 201.4, Jane, Wk 3 2024". */
  markLabel?: string | null;
}

/**
 * Every weekly score ever, as a histogram. The bins holding the all-time high
 * and low are coloured and flagged with a reference line, so the extremes read
 * against the whole distribution. Plain data in, no functions — this is fed
 * from a server page.
 */
export function ScoreHistogramChart({ bins, median }: { bins: HistogramBin[]; median: number }) {
  const medianBin = bins.find((b) => median >= b.from && median < b.to)?.label;
  const high = bins.find((b) => b.mark === "high");
  const low = bins.find((b) => b.mark === "low");
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={bins} margin={{ top: 22, right: 12, left: 4, bottom: 18 }} barCategoryGap={1}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          {...AXIS_PROPS}
          interval="preserveStartEnd"
          minTickGap={8}
          label={{ value: "Points scored (10-point bins)", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          {...AXIS_PROPS}
          width={40}
          allowDecimals={false}
          label={{ value: "Scores", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11, dx: 6 }}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          content={({ payload }) => {
            const b = payload?.[0]?.payload as HistogramBin | undefined;
            if (!b) return null;
            return (
              <div style={TOOLTIP_STYLE} className="px-2 py-1">
                <div className="font-semibold">
                  {b.from}–{(b.to - 0.01).toFixed(2)} pts
                </div>
                <div>
                  {b.count} score{b.count === 1 ? "" : "s"}
                </div>
                {b.markLabel ? <div className="text-muted-foreground">{b.markLabel}</div> : null}
              </div>
            );
          }}
        />
        {medianBin ? (
          <ReferenceLine x={medianBin} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: "median", position: "top", fill: "var(--muted-foreground)", fontSize: 10 }} />
        ) : null}
        {low ? (
          <ReferenceLine x={low.label} stroke={RESULT_COLORS.loss} strokeDasharray="2 3" label={{ value: "record low", position: "top", fill: RESULT_COLORS.loss, fontSize: 10 }} />
        ) : null}
        {high ? (
          <ReferenceLine x={high.label} stroke={RESULT_COLORS.win} strokeDasharray="2 3" label={{ value: "record high", position: "top", fill: RESULT_COLORS.win, fontSize: 10 }} />
        ) : null}
        <Bar dataKey="count" name="Scores" isAnimationActive={false} radius={[2, 2, 0, 0]}>
          {bins.map((b) => (
            <Cell
              key={b.label}
              fill={b.mark === "high" ? RESULT_COLORS.win : b.mark === "low" ? RESULT_COLORS.loss : "var(--primary)"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
