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
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/admin/:path*", "/chat-lore/:path*"],
};
