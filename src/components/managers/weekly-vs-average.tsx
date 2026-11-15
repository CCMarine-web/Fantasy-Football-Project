"use client";

import { useState } from "react";
import { ChartFrame } from "@/components/charts/chart-frame";
import { ResultBars, type ResultBarDatum } from "@/components/charts/team-charts";

/**
 * Weekly score vs league average, one season at a time (Sleeper seasons — the
 * ESPN archive has no reliable per-week detail here). Bars above zero: a better
 * week than the league's average team; filled bars are wins, outlined bars
 * losses, so a bar above zero that is outlined is a good week that lost.
 */
export function WeeklyVsAverage({
  seasons,
  managerName,
}: {
  /** Newest first. */
  seasons: { year: number; weeks: ResultBarDatum[] }[];
  managerName: string;
}) {
  const [year, setYear] = useState(seasons[0]?.year ?? null);
  const current = seasons.find((s) => s.year === year) ?? seasons[0];
  if (!current) return null;
  const above = current.weeks.filter((w) => w.value > 0).length;
  const unluckyLosses = current.weeks.filter((w) => w.value > 0 && w.result === "L").length;
  return (
    <div className="space-y-2">
      {seasons.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Season">
          {seasons.map((s) => (
            <button
              key={s.year}
              type="button"
              onClick={() => setYear(s.year)}
              aria-pressed={s.year === current.year}
              className={`min-h-11 rounded-full border px-4 text-sm ${s.year === current.year ? "border-primary bg-primary/15 font-semibold text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {s.year}
            </button>
          ))}
        </div>
      ) : null}
      <ChartFrame
        title={`Weekly score vs. league average, ${current.year}`}
        caption="Each week: points scored minus that week's league average. Filled bars are wins, outlined bars losses. Tap a bar for the opponent."
        summary={`${managerName} beat the league average in ${above} of ${current.weeks.length} weeks in ${current.year}${unluckyLosses ? `, and lost ${unluckyLosses} of those` : ""}.`}
        table={{
          headers: ["Week", "Vs average", "Result", "Game"],
          rows: current.weeks.map((w) => [w.label, w.value.toFixed(1), w.result, w.detail]),
        }}
        height="h-64"
      >
        <ResultBars data={current.weeks} />
      </ChartFrame>
    </div>
  );
}
