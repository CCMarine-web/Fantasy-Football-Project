/**
 * Countdown arithmetic, in a plain module so BOTH the server and the client
 * can call it.
 *
 * It used to live in the `"use client"` countdown component, which meant the
 * homepage — a server component — could not call it to compute the starting
 * figure. Next accepted that at build time and threw at runtime: "Attempted to
 * call initialRemaining() from the server but initialRemaining is on the
 * client", which took the whole homepage to a 500 in production.
 */

export interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  passed: boolean;
}

export function computeRemaining(targetMs: number, nowMs: number): Remaining {
  const diff = targetMs - nowMs;
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

/**
 * The server calls this at render time and passes the result in, so the first
 * paint shows the real figure. Without it the digits rendered as 00:00:00:00
 * until the first client tick, which reads as a broken or expired countdown.
 */
export function initialRemaining(isoDate: string, nowMs: number): Remaining | null {
  const targetMs = new Date(isoDate).getTime();
  if (Number.isNaN(targetMs)) return null;
  return computeRemaining(targetMs, nowMs);
}
