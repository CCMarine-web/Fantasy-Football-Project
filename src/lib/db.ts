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

function getClient(): PrismaClient {
  const client = globalThis.__prisma ?? createPrismaClient();
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
