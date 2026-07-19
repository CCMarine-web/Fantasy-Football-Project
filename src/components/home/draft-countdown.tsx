"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  passed: boolean;
}

function computeRemaining(targetMs: number): Remaining {
  const diff = targetMs - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, passed: true };
  const seconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
    passed: false,
  };
}

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-heading text-3xl font-semibold tabular-nums text-primary-foreground">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[10px] tracking-[0.15em] text-primary-foreground/70 uppercase">{label}</span>
    </div>
  );
}

/**
 * Live draft countdown. The target date comes from LEAGUE_CONFIG.draftDate
 * (passed in as an ISO string so this stays a pure client component). Renders
 * nothing until mounted to avoid a server/client time mismatch, and switches
 * to a "draft is here" state once the date passes.
 */
export function DraftCountdown({ isoDate }: { isoDate: string }) {
  const targetMs = new Date(isoDate).getTime();
  const [remaining, setRemaining] = useState<Remaining | null>(null);

  useEffect(() => {
    if (Number.isNaN(targetMs)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setRemaining(computeRemaining(targetMs));
      timer = setTimeout(tick, 1000);
    };
    // Schedule the first tick asynchronously (not synchronously in the effect
    // body) so state is only set from a timer callback.
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [targetMs]);

  if (Number.isNaN(targetMs)) return null;

  const dateLabel = new Date(isoDate).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl bg-primary px-5 py-4 text-primary-foreground shadow-lg">
      <div className="flex items-center gap-2">
        <CalendarClock className="h-4 w-4" />
        <p className="text-xs font-semibold tracking-[0.2em] uppercase">
          {remaining?.passed ? "Draft is here" : "Countdown to Draft"}
        </p>
      </div>
      {remaining?.passed ? (
        <p className="mt-2 font-heading text-2xl font-semibold uppercase">It&apos;s draft time — good luck.</p>
      ) : (
        <div className="mt-3 flex items-center justify-between gap-1">
          <Unit value={remaining?.days ?? 0} label="Days" />
          <span className="font-heading text-xl text-primary-foreground/40">:</span>
          <Unit value={remaining?.hours ?? 0} label="Hrs" />
          <span className="font-heading text-xl text-primary-foreground/40">:</span>
          <Unit value={remaining?.minutes ?? 0} label="Min" />
          <span className="font-heading text-xl text-primary-foreground/40">:</span>
          <Unit value={remaining?.seconds ?? 0} label="Sec" />
        </div>
      )}
      <p className="mt-3 text-xs text-primary-foreground/70">{dateLabel}</p>
    </div>
  );
}
