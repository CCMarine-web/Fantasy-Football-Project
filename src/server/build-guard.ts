import { connection } from "next/server";

/**
 * BUILD GUARD — pre-rendering without making the build depend on the database.
 *
 * The data pages are ISR: rendered at build, then refreshed by the pipeline.
 * That means `next build` queries the database. On Production that works (the
 * build has DATABASE_URL and can reach Supabase), but a build that can't —
 * a Vercel Preview environment without the database variables, a CI check, a
 * Supabase outage during a deploy — used to fail outright ("Missing or invalid
 * environment variables: DATABASE_URL").
 *
 * With the guard, a build that can't reach the database still succeeds: ISR
 * pages defer to request time (`connection()`), and generateStaticParams
 * returns no params (those pages render on first request). When the database
 * IS reachable, nothing changes — pages pre-render exactly as before.
 */

const BUILD_PHASE = "phase-production-build";

let reachable: Promise<boolean> | null = null;

function isBuild(): boolean {
  return process.env.NEXT_PHASE === BUILD_PHASE;
}

/** Checked once per build worker: env present and `SELECT 1` answers within 8 s. */
export function databaseReachableAtBuild(): Promise<boolean> {
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) return Promise.resolve(false);
  reachable ??= (async () => {
    try {
      const { prisma } = await import("@/lib/db");
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 8000)),
      ]);
      return true;
    } catch {
      return false;
    }
  })();
  return reachable;
}

/** Call first in an ISR page: renders at request time if the build has no database. */
export async function renderAtRequestIfNoDatabase(): Promise<void> {
  if (!isBuild()) return;
  if (await databaseReachableAtBuild()) return;
  await connection();
}

/** generateStaticParams that returns [] (on-demand ISR) when the build has no database. */
export async function staticParamsOrEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  if (isBuild() && !(await databaseReachableAtBuild())) return [];
  try {
    return await load();
  } catch {
    return [];
  }
}

/** For layout pieces rendered into every page: skip the database at a database-less build. */
export async function skipAtDatabaselessBuild(): Promise<boolean> {
  return isBuild() && !(await databaseReachableAtBuild());
}
