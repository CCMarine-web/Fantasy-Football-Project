import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

declare global {
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: getEnv().DATABASE_URL });
  return new PrismaClient({ adapter });
}

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  // Cache the client in a module-level variable so it's constructed exactly
  // once and reused for the life of the process — critical in production,
  // where a new PrismaClient (and pg pool) per access would exhaust database
  // connections. In development we also stash it on globalThis so it survives
  // hot-module reloads instead of leaking a new client on every edit.
  if (client) return client;
  client = globalThis.__prisma ?? createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = client;
  }
  return client;
}

/**
 * Lazy Prisma singleton. The real client (and its env validation via
 * `getEnv()`) is only constructed on first property access, NOT at module
 * import. This matters for `next build`: collecting page data imports route
 * modules (e.g. the NextAuth handler) that transitively import this file, and
 * we don't want that to require DATABASE_URL/AUTH_SECRET to be present at
 * build time — those are runtime secrets. Access `prisma.user`, etc. exactly
 * as before; construction happens transparently on first use.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof PrismaClient];
    // Bind client-level methods ($transaction, $queryRaw, $disconnect, …) so
    // they keep the right `this`; model delegates (prisma.user, …) are plain
    // objects Prisma already binds internally, so pass those through as-is.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * True when `err` is a database *availability* problem (server unreachable,
 * connection dropped, or required env vars missing) rather than a genuine
 * query/logic bug. Used by data-fetching code to degrade to a friendly
 * "configure your league" state instead of crashing, while still letting real
 * bugs surface. Prisma connection errors: P1000 (auth), P1001 (unreachable),
 * P1002 (timeout), P1017 (connection closed).
 */
export function isDatabaseUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && ["P1000", "P1001", "P1002", "P1017"].includes(code)) {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  if (typeof message === "string") {
    return (
      message.includes("Can't reach database server") ||
      message.includes("environment variables") ||
      message.includes("DatabaseNotReachable") ||
      message.includes("Connection terminated")
    );
  }
  return false;
}
