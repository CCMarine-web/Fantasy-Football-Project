import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Next.js 16 renamed `middleware.ts`/`middleware()` to `proxy.ts`/`proxy()`.
// This always runs on the Node.js runtime (no edge option), which is fine
// since our Credentials + Prisma auth flow needs Node APIs anyway.
export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  const isProtected = pathname.startsWith("/admin") || pathname.startsWith("/chat-lore");
  if (!isProtected) return;

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
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/admin/:path*", "/chat-lore/:path*"],
};
