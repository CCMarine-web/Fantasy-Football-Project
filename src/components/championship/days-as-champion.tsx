"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";

interface Elapsed {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeElapsed(startMs: number): Elapsed {
  const diff = Math.max(0, Date.now() - startMs);
  const seconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

/**
 * Live "N days as champion" counter, counting UP from the reign-start ISO date
 * (passed in as a string so this stays a pure client component). Follows the
 * draft-countdown effect pattern — schedules the first tick asynchronously via
 * setTimeout so state is only ever set from a timer callback (keeps the
 * react-hooks/set-state-in-effect lint rule happy) and clears on unmount.
 * Renders nothing until mounted to avoid a server/client time mismatch.
 */
export function DaysAsChampion({ isoStart }: { isoStart: string }) {
  const startMs = new Date(isoStart).getTime();
  const [elapsed, setElapsed] = useState<Elapsed | null>(null);

  useEffect(() => {
    if (Number.isNaN(startMs)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setElapsed(computeElapsed(startMs));
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [startMs]);

  if (Number.isNaN(startMs) || !elapsed) return null;

  return (
    <div className="inline-flex items-baseline gap-2">
      <Crown className="h-6 w-6 shrink-0 translate-y-1 text-primary" aria-hidden />
      <span className="font-heading text-4xl font-semibold tabular-nums text-primary sm:text-5xl">
        {elapsed.days.toLocaleString()}
      </span>
      <span className="font-heading text-lg font-semibold tracking-wide uppercase">
        {elapsed.days === 1 ? "day" : "days"} as champion
      </span>
      <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
        {String(elapsed.hours).padStart(2, "0")}:{String(elapsed.minutes).padStart(2, "0")}:
        {String(elapsed.seconds).padStart(2, "0")}
      </span>
    </div>
  );
}
