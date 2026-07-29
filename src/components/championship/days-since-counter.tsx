"use client";

import { useEffect, useState } from "react";
import { computeElapsed, type Elapsed } from "@/lib/countdown";

/**
 * Generic live "N days since <label>" counter, counting UP from an ISO date.
 * Used by the Championship Belt shame counter.
 *
 * Same shape as DaysAsChampion: the starting figure is computed on the server
 * and passed in so it is present on first paint, then ticked from a timer
 * callback and cleared on unmount.
 *
 * `label` is the sentence tail after the day count, e.g. "since Anthony last
 * won a playoff game".
 */
export function DaysSinceCounter({
  isoStart,
  label,
  initial = null,
}: {
  isoStart: string;
  label: string;
  initial?: Elapsed | null;
}) {
  const startMs = new Date(isoStart).getTime();
  const [state, setState] = useState<Elapsed | null>(initial);

  useEffect(() => {
    if (Number.isNaN(startMs)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setState(computeElapsed(startMs, Date.now()));
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [startMs]);

  if (Number.isNaN(startMs) || !state) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1" suppressHydrationWarning>
      <span className="font-heading text-4xl font-semibold tabular-nums text-primary sm:text-5xl">
        {state.days.toLocaleString()}
      </span>
      <span className="font-heading text-lg font-semibold tracking-wide uppercase">
        {state.days === 1 ? "day" : "days"} {label}
      </span>
      <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
        {String(state.hours).padStart(2, "0")}:{String(state.minutes).padStart(2, "0")}:
        {String(state.seconds).padStart(2, "0")}
      </span>
    </div>
  );
}
