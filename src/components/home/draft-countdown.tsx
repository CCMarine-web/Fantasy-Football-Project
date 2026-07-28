"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { computeRemaining, type Remaining } from "@/lib/countdown";

function Unit({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-heading text-3xl font-semibold tabular-nums text-primary-foreground">
        {String(value).padStart(2, "0")}
      </span>
      <span className="text-[12px] tracking-[0.15em] text-primary-foreground/70 uppercase">{label}</span>
    </div>
  );
}

/**
 * Live draft countdown. The target date comes from LEAGUE_CONFIG.draftDate
 * (passed in as an ISO string so this stays a pure client component). The
 * ticking digits render as zeros until the first timer tick so SSR and the
 * first client render agree; the date label is formatted in a FIXED locale and
 * timezone for the same reason — formatting it with the viewer's locale would
 * produce different text on the server (UTC) than in the browser and trip a
 * hydration mismatch. Showing league time is also just more useful: everyone
 * sees the same draft time the commissioner announced.
 */
export function DraftCountdown({
  isoDate,
  timeZone = "America/Chicago",
  initial = null,
}: {
  isoDate: string;
  timeZone?: string;
  /**
   * Server-computed starting figure. Both the server render and the client's
   * first render use this exact value, so there is no hydration mismatch and no
   * frame of zeros before the timer starts.
   */
  initial?: Remaining | null;
}) {
  const targetMs = new Date(isoDate).getTime();
  const [remaining, setRemaining] = useState<Remaining | null>(initial);

  useEffect(() => {
    if (Number.isNaN(targetMs)) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setRemaining(computeRemaining(targetMs, Date.now()));
      timer = setTimeout(tick, 1000);
    };
    // Schedule the first tick asynchronously (not synchronously in the effect
    // body) so state is only set from a timer callback.
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [targetMs]);

  if (Number.isNaN(targetMs)) return null;

  // Fixed locale + timezone => byte-identical on server and client.
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(new Date(isoDate));

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
      ) : remaining ? (
        <div className="mt-3 flex items-center justify-between gap-1">
          <Unit value={remaining.days} label="Days" />
          <span className="font-heading text-xl text-primary-foreground/40">:</span>
          <Unit value={remaining.hours} label="Hrs" />
          <span className="font-heading text-xl text-primary-foreground/40">:</span>
          <Unit value={remaining.minutes} label="Min" />
          <span className="font-heading text-xl text-primary-foreground/40">:</span>
          <Unit value={remaining.seconds} label="Sec" />
        </div>
      ) : (
        // Only reachable if no starting figure was supplied. Says what it is
        // doing rather than showing a row of zeros that reads as "expired".
        <p className="mt-3 font-heading text-lg font-semibold">Calculating countdown…</p>
      )}
      <p className="mt-3 text-xs text-primary-foreground/70">{dateLabel}</p>
    </div>
  );
}
