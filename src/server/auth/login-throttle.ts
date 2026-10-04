import { prisma } from "@/lib/db";

/**
 * Sign-in rate limiting.
 *
 * Every failed attempt is counted against the email AND the client address.
 * Too many failures inside the window locks that key for LOCK_MS; a lock is
 * checked before the password is, so a locked account costs an attacker a
 * cheap refusal rather than another guess. A successful sign-in clears the
 * email's counter (not the address's — one good password must not reset an
 * address that has been spraying other accounts).
 *
 * Counts live in the LoginThrottle table rather than memory because each
 * serverless instance would otherwise keep its own, and an attacker's requests
 * spread across instances would never trip any of them.
 */

export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;
export const LIMITS = { email: 5, ip: 20 } as const;

export interface ThrottleState {
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
}

export function isLocked(state: ThrottleState | null, now: Date): boolean {
  return !!state?.lockedUntil && state.lockedUntil.getTime() > now.getTime();
}

/** The state after one more failure. Pure. */
export function afterFailure(state: ThrottleState | null, now: Date, limit: number): ThrottleState {
  const fresh = !state || now.getTime() - state.windowStart.getTime() > WINDOW_MS;
  const failures = fresh ? 1 : state.failures + 1;
  const windowStart = fresh ? now : state.windowStart;
  const lockedUntil = failures >= limit ? new Date(now.getTime() + LOCK_MS) : (state?.lockedUntil ?? null);
  return { failures, windowStart, lockedUntil };
}

export function throttleKeys(email: string, ip: string | null): { key: string; limit: number }[] {
  const keys: { key: string; limit: number }[] = [{ key: `email:${email.trim().toLowerCase()}`, limit: LIMITS.email }];
  if (ip) keys.push({ key: `ip:${ip}`, limit: LIMITS.ip });
  return keys;
}

/** The first address in x-forwarded-for (set by Vercel), else x-real-ip. */
export function clientIp(headers: Headers | undefined): string | null {
  const forwarded = headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers?.get("x-real-ip")?.trim() || null;
}

export async function isThrottled(email: string, ip: string | null, now = new Date()): Promise<boolean> {
  const keys = throttleKeys(email, ip).map((k) => k.key);
  const rows = await prisma.loginThrottle.findMany({ where: { key: { in: keys } } });
  return rows.some((r) => isLocked(r, now));
}

export async function recordFailure(email: string, ip: string | null, now = new Date()): Promise<void> {
  for (const { key, limit } of throttleKeys(email, ip)) {
    const current = await prisma.loginThrottle.findUnique({ where: { key } });
    const next = afterFailure(current, now, limit);
    await prisma.loginThrottle.upsert({ where: { key }, create: { key, ...next }, update: next });
  }
}

export async function recordSuccess(email: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { key: throttleKeys(email, null)[0].key } });
}
