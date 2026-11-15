import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { canonicalUrl, robotsHeaderFor } from "@/lib/indexing";

// Next.js 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`.
// This always runs on the Node.js runtime (no edge option), which is fine
// since our Credentials + Prisma auth flow needs Node APIs anyway.

/** Admin-only paths: the auth check runs here, and again on the server. */
function isProtected(pathname: string): boolean {
  // The belt editor lives under /championship-belt but is admin-only; without
  // this a signed-out visitor got the generic "couldn't load this page" error.
  return pathname.startsWith("/admin") || pathname.startsWith("/chat-lore") || pathname === "/championship-belt/edit";
}

const guard = auth((req) => {
  const role = req.auth?.user?.role;
  if (!req.auth || role !== "ADMIN") {
    /*
     * The redirect is built from the host the visitor actually used, not from
     * `req.nextUrl.origin`.
     *
     * NextAuth normalises the request URL against AUTH_URL, so `origin` is
     * whatever AUTH_URL says — which sent an admin browsing a preview
     * deployment (or a locally-built server on a different port) to a login
     * page on a completely different host. Preferring the forwarded host keeps
     * the visitor on the site they are actually on.
     */
    const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
    const origin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : req.nextUrl.origin;
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
});

/**
 * Search headers on every page (lib/indexing.ts is the one list):
 *   - X-Robots-Tag: noindex on everything but allowlisted www pages without a
 *     query string, and on every non-www host (deployment/preview URLs);
 *   - Link: <https://www.rattrapfantasy.com/path>; rel="canonical" — a
 *     self-referencing, query-free canonical for every page.
 */
function withSearchHeaders(req: NextRequest, res: NextResponse): NextResponse {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const robots = robotsHeaderFor({ host, pathname: req.nextUrl.pathname, search: req.nextUrl.search });
  if (robots) res.headers.set("X-Robots-Tag", robots);
  res.headers.set("Link", `<${canonicalUrl(req.nextUrl.pathname)}>; rel="canonical"`);
  return res;
}

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  if (isProtected(req.nextUrl.pathname)) {
    const blocked = await (guard as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response | undefined>)(req, event);
    if (blocked) {
      blocked.headers.set("X-Robots-Tag", "noindex, nofollow");
      return blocked;
    }
  }
  return withSearchHeaders(req, NextResponse.next());
}

export const config = {
  // Every page; not API routes, Next's static/image files, or files with an
  // extension (robots.txt, sitemap.xml, icons, images).
  matcher: ["/((?!api/|_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)"],
};
