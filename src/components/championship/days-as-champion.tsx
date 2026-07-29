"use client";

import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import { computeElapsed, type Elapsed } from "@/lib/countdown";

/**
 * Live "N days as champion" counter, counting UP from the reign-start ISO date.
 *
 * `initial` is computed on the SERVER and passed in, so the real number is in
 * the HTML on first paint. Without it the component rendered nothing until the
 * first client tick, which on the Championship Belt page left a blank where the
 * headline figure belongs — and left nothing at all for a reader whose
 * JavaScript never arrived.
 *
 * The ticking follows the draft-countdown pattern: the first tick is scheduled
 * asynchronously via setTimeout so state is only ever set from a timer callback
 * (keeping the react-hooks/set-state-in-effect rule satisfied), and the timer is
 * cleared on unmount. `suppressHydrationWarning` covers the one-second window in
 * which the server's figure and the client's can legitimately differ.
 */
export function DaysAsChampion({
  isoStart,
  initial = null,
}: {
  isoStart: string;
  initial?: Elapsed | null;
}) {
  const startMs = new Date(isoStart).getTime();
  const [elapsed, setElapsed] = useState<Elapsed | null>(initial);

  useEffect(() => {
    if (Number.isNaN(startMs)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setElapsed(computeElapsed(startMs, Date.now()));
      timer = setTimeout(tick, 1000);
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [startMs]);

  if (Number.isNaN(startMs) || !elapsed) return null;

  return (
    <div className="inline-flex items-baseline gap-2" suppressHydrationWarning>
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
