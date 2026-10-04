import { timingSafeEqual } from "node:crypto";

/**
 * Who may trigger the weekly refresh.
 *
 * Fails closed: a production build (Vercel production and preview, or a local
 * `next start`) with no CRON_SECRET rejects every request. The endpoint used
 * to treat a missing secret as "open to anyone", so a variable forgotten in
 * one Vercel environment quietly published a URL that runs a four-step job
 * with database writes and paid model calls.
 *
 * Only `next dev` runs without a secret, so the job can be exercised locally
 * with a plain request (`npm run cron:trigger`).
 */

export type CronAuthResult = { ok: true } | { ok: false; status: 401 | 503; error: string };

export interface CronAuthInput {
  /** CRON_SECRET, trimmed or not. Empty means unset. */
  secret: string;
  /** The request's Authorization header, if any. */
  authorization: string | null;
  /** process.env.NODE_ENV — "development" only under `next dev`. */
  nodeEnv: string | undefined;
}

function sameString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authorizeCronRequest({ secret, authorization, nodeEnv }: CronAuthInput): CronAuthResult {
  const expected = secret.trim();
  if (!expected) {
    if (nodeEnv === "development") return { ok: true };
    return {
      ok: false,
      status: 503,
      error: "CRON_SECRET is not configured, so the weekly refresh is disabled.",
    };
  }
  if (authorization && sameString(authorization, `Bearer ${expected}`)) return { ok: true };
  return { ok: false, status: 401, error: "unauthorized" };
}
