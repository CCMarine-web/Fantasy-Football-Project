import { prisma } from "@/lib/db";

/**
 * A database lease so pipeline runs never overlap — a cron firing during a
 * manual run, a Vercel retry, a CLI backfill. Postgres advisory locks don't
 * survive Supabase's transaction-mode pooler, so this is a row with an expiry:
 * a run that dies mid-way stops blocking others once its lease runs out.
 */

const LOCK_NAME = "pipeline";
/** Longer than the longest function run (300 s), shorter than the gap between jobs. */
export const LEASE_MS = 10 * 60_000;

export async function acquireLock(holder: string, nowMs = Date.now()): Promise<boolean> {
  const expiresAt = new Date(nowMs + LEASE_MS);
  try {
    await prisma.pipelineLock.create({ data: { name: LOCK_NAME, holder, expiresAt } });
    return true;
  } catch {
    // Row exists: take it only if the previous lease has expired.
    const taken = await prisma.pipelineLock.updateMany({
      where: { name: LOCK_NAME, expiresAt: { lt: new Date(nowMs) } },
      data: { holder, expiresAt, acquiredAt: new Date(nowMs) },
    });
    return taken.count === 1;
  }
}

/** Extends the lease while a long run is still making progress. */
export async function renewLock(holder: string, nowMs = Date.now()): Promise<void> {
  await prisma.pipelineLock.updateMany({
    where: { name: LOCK_NAME, holder },
    data: { expiresAt: new Date(nowMs + LEASE_MS) },
  });
}

export async function releaseLock(holder: string): Promise<void> {
  await prisma.pipelineLock.deleteMany({ where: { name: LOCK_NAME, holder } });
}

/** Who holds the lock, if anyone, for /api/health and the admin page. */
export async function currentLock(): Promise<{ holder: string; expiresAt: Date } | null> {
  const row = await prisma.pipelineLock.findUnique({ where: { name: LOCK_NAME } });
  return row && row.expiresAt.getTime() > Date.now() ? { holder: row.holder, expiresAt: row.expiresAt } : null;
}
