"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS_PROPS, TOOLTIP_STYLE } from "@/lib/chart-theme";

export interface SeasonScoringPoint {
  season: number;
  averageScore: number;
  /** A season still being played: drawn hollow and labelled, never final. */
  inProgress?: boolean;
}

/** A rule or platform change, drawn as a labelled vertical line at its season. */
export interface ScoringAnnotation {
  season: number;
  /** Short on-chart label, e.g. "PPR". Keep it to a word. */
  label: string;
  /** Tooltip / caption sentence. */
  detail: string;
  /** Which side of the line the label sits on, to keep neighbours apart. */
  side?: "left" | "right";
}

/**
 * League-average weekly score by season, with rule changes marked.
 *
 * The y-axis is fitted to the data, not pinned to zero: every season sits
 * between roughly 85 and 135, and on a zero-based axis the PPR jump — the most
 * important thing on the chart — flattened into a ripple.
 */
export function LeagueScoringTrendChart({
  data,
  annotations = [],
}: {
  data: SeasonScoringPoint[];
  annotations?: ScoringAnnotation[];
}) {
  const values = data.map((d) => d.averageScore);
  const lo = Math.floor((Math.min(...values) - 5) / 10) * 10;
  const hi = Math.ceil((Math.max(...values) + 15) / 10) * 10;
  const noteFor = new Map(annotations.map((a) => [a.season, a]));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 14, left: 4, bottom: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="season"
          {...AXIS_PROPS}
          interval="preserveStartEnd"
          tickFormatter={(v: number) => `'${String(v).slice(2)}`}
          label={{ value: "Season", position: "insideBottom", offset: -10, fill: "var(--muted-foreground)", fontSize: 11 }}
        />
        <YAxis
          {...AXIS_PROPS}
          width={40}
          domain={[lo, hi]}
          allowDecimals={false}
          label={{ value: "Avg. score", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11, dx: 6 }}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as SeasonScoringPoint | undefined;
            if (!p) return null;
            const note = noteFor.get(p.season);
            return (
              <div style={TOOLTIP_STYLE} className="max-w-56 px-2 py-1">
                <div className="font-semibold">
                  {p.season}
                  {p.inProgress ? " (in progress)" : ""}
                </div>
                <div>{p.averageScore.toFixed(1)} avg. weekly score</div>
                {note ? <div className="mt-0.5 text-muted-foreground">{note.detail}</div> : null}
              </div>
            );
          }}
        />
        {annotations.map((a) => (
          <ReferenceLine
            key={a.season}
            x={a.season}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{
              value: a.label,
              position: a.side === "left" ? "insideTopRight" : "insideTopLeft",
              fill: "var(--muted-foreground)",
              fontSize: 10,
            }}
          />
        ))}
        <Line
          type="linear"
          dataKey="averageScore"
          name="Avg. weekly score"
          stroke="var(--gold)"
          strokeWidth={2}
          isAnimationActive={false}
          dot={(props: { cx?: number; cy?: number; payload?: SeasonScoringPoint; index?: number }) => {
            if (props.cx == null || props.cy == null) return <g key={props.index} />;
            return props.payload?.inProgress ? (
              <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--background)" stroke="var(--gold)" strokeWidth={2}>
                <title>{props.payload.season} in progress</title>
              </circle>
            ) : (
              <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--gold)" />
            );
          }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
