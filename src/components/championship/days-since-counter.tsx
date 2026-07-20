"use client";

import { useEffect, useState } from "react";

function computeDays(startMs: number): { days: number; h: number; m: number; s: number } {
  const diff = Math.max(0, Date.now() - startMs);
  const seconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(seconds / 86400),
    h: Math.floor((seconds % 86400) / 3600),
    m: Math.floor((seconds % 3600) / 60),
    s: seconds % 60,
  };
}

/**
 * Generic live "N days since <label>" counter, counting UP from an ISO date.
 * Used by the Championship Belt shame counter. Same effect pattern as
 * DaysAsChampion / DraftCountdown: first tick scheduled via setTimeout, cleared
 * on unmount, and nothing rendered until mounted (avoids hydration mismatch).
 *
 * `label` is the sentence tail after the day count, e.g. "since Anthony last
 * won a playoff game".
 */
export function DaysSinceCounter({ isoStart, label }: { isoStart: string; label: string }) {
  const startMs = new Date(isoStart).getTime();
  const [state, setState] = useState<ReturnType<typeof computeDays> | null>(null);

  useEffect(() => {
    if (Number.isNaN(startMs)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setState(computeDays(startMs));
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [startMs]);

  if (Number.isNaN(startMs) || !state) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-heading text-4xl font-semibold tabular-nums text-primary sm:text-5xl">
        {state.days.toLocaleString()}
      </span>
      <span className="font-heading text-lg font-semibold tracking-wide uppercase">
        {state.days === 1 ? "day" : "days"} {label}
      </span>
      <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
        {String(state.h).padStart(2, "0")}:{String(state.m).padStart(2, "0")}:
        {String(state.s).padStart(2, "0")}
      </span>
    </div>
  );
}
