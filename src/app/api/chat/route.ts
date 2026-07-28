import { NextResponse, type NextRequest } from "next/server";
import { listPublicMessages, postPublicMessage } from "@/server/chat/public-chat";

/**
 * Public shoutbox endpoint. No authentication — that is the point of the page.
 *
 * GET  returns the visible feed.
 * POST accepts { displayName, body } and returns the created message.
 *
 * All validation, moderation and rate limiting lives in
 * server/chat/public-chat.ts so the HTTP layer stays thin and the same rules
 * apply however the endpoint is reached.
 *
 * The response never includes `authorHash`, `hiddenBy` or anything else
 * technical — the select lists in the server module are the boundary.
 */

/** Always fresh: a cached chat feed is a broken chat feed. */
export const dynamic = "force-dynamic";

/**
 * Best-effort client address for rate limiting. Behind Vercel the leftmost
 * x-forwarded-for entry is the real client. It is hashed with a secret salt
 * before it touches the database and is never returned to a caller.
 */
function clientAddress(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

export async function GET() {
  try {
    const messages = await listPublicMessages();
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Never leak a database error message to an unauthenticated caller.
    return NextResponse.json({ error: "Chat is unavailable right now." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const { displayName, body } = (payload ?? {}) as { displayName?: unknown; body?: unknown };

  try {
    const result = await postPublicMessage(displayName, body, clientAddress(request));
    if (!result.ok) {
      // 429 for the rate-limit refusals so clients can back off correctly.
      const isRateLimit = /too quickly|Slow down|busy right now/i.test(result.error);
      return NextResponse.json({ error: result.error }, { status: isRateLimit ? 429 : 400 });
    }
    return NextResponse.json({ message: result.message }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not post that. Try again." }, { status: 503 });
  }
}
