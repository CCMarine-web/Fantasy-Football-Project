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

export interface Elapsed {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Time since a point in the past, in the same shape as `Remaining`. */
export function computeElapsed(startMs: number, nowMs: number): Elapsed {
  const seconds = Math.floor(Math.max(0, nowMs - startMs) / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
}

/**
 * The server-rendered starting figure for a count-UP timer, for the same reason
 * `initialRemaining` exists.
 *
 * The reign counter used to render nothing at all until the first client tick,
 * so the Championship Belt page showed a blank where the headline number should
 * be — and showed nothing whatsoever to a reader with JavaScript disabled or a
 * slow first paint. Seeding it from the server means the number is in the HTML.
 */
export function initialElapsed(isoStart: string, nowMs: number): Elapsed | null {
  const startMs = new Date(isoStart).getTime();
  if (Number.isNaN(startMs)) return null;
  return computeElapsed(startMs, nowMs);
}
