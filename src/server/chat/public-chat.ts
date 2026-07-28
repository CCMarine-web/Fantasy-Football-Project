import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * The PUBLIC shoutbox — the open chat page anyone with the link can post to.
 *
 * ── Not the private archive ────────────────────────────────────────────────
 * This has nothing to do with the imported group-chat history. That lives in
 * ChatMessage / ChatImport, is admin-gated, and is never read, searched or
 * surfaced from here. Nothing in this module touches those tables.
 *
 * ── Threat model ──────────────────────────────────────────────────────────
 * Every field is attacker-controlled and there is no account to hold anyone to.
 * So:
 *  - Length caps and trimming happen on WRITE, before anything is stored.
 *  - Control characters are stripped; the body is stored as plain text.
 *  - Rendering is React text interpolation, never `dangerouslySetInnerHTML`,
 *    so markup in a message is displayed literally rather than parsed. There is
 *    no sanitiser to bypass because there is no HTML path.
 *  - Names that impersonate the site, an admin or the system are rejected.
 *  - Rate limits are enforced per salted address digest AND globally, so one
 *    source cannot flood and a botnet cannot either.
 *  - The raw IP is never persisted; only a salted, truncated digest, which is
 *    enough to rate-limit and to block a source but is not personal data at
 *    rest and is never shown.
 */

import {
  FEED_LIMIT,
  MAX_BODY_LENGTH,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  type PublicChatMessageView,
} from "@/lib/public-chat-shared";

// Re-exported so server callers have one import site.
export { FEED_LIMIT, MAX_BODY_LENGTH, MAX_NAME_LENGTH, type PublicChatMessageView };

/** Per-source: at most this many messages in the window. */
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** Per-source: minimum gap between two messages. */
const MIN_GAP_MS = 3_000;
/** League-wide circuit breaker, so a distributed flood still hits a ceiling. */
const GLOBAL_LIMIT_COUNT = 60;
const GLOBAL_LIMIT_WINDOW_MS = 60_000;

/**
 * Names nobody may self-assign. These are the identities a reader would trust,
 * so letting a visitor wear one turns the shoutbox into a phishing surface.
 */
const RESERVED_NAME_PATTERNS: RegExp[] = [
  /^\s*admin/i,
  /^\s*administrator/i,
  /^\s*moderator/i,
  /^\s*mod\b/i,
  /^\s*system/i,
  /^\s*commissioner/i,
  /^\s*the\s*rat\s*trap/i,
  /^\s*rat\s*trap/i,
  /^\s*official/i,
  /^\s*support/i,
  /^\s*staff/i,
  /^\s*owner/i,
  /\bbot\s*$/i,
];

/**
 * Default moderation list. Deliberately narrow: slurs and spam markers only.
 * The league's own tone is crude by design, so ordinary profanity is allowed —
 * over-filtering would make the page useless for its actual audience.
 * Extendable via CHAT_BLOCKED_WORDS without a deploy.
 */
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /\bn[i1]gg(er|a)\b/i,
  /\bf[a4]gg?[o0]t\b/i,
  /\bk[i1]ke\b/i,
  /\btr[a4]nn?y\b/i,
  /\bret[a4]rd\b/i,
  // Spam shapes rather than words.
  /\b(?:https?:\/\/|www\.)\S+\b.*\b(?:https?:\/\/|www\.)\S+/i, // 2+ links
  /\b(?:free|cheap)\s+(?:v[i1]agra|c[i1]al[i1]s|crypto|bitcoin|followers)\b/i,
];

/**
 * Reads the extra blocked words straight from `process.env` rather than through
 * `getEnv()`. Deliberate: `getEnv()` validates the whole environment including
 * DATABASE_URL and AUTH_SECRET, which would make `validateSubmission` — a pure
 * string function — fail without a database. The moderation list is an optional
 * comma-separated string with a safe empty default, so it needs no validation.
 */
function blockedPatterns(): RegExp[] {
  const extra = (process.env.CHAT_BLOCKED_WORDS ?? "")
    .split(",")
    .map((w) => w.trim())
    .filter(Boolean)
    .map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
  return [...DEFAULT_BLOCKED_PATTERNS, ...extra];
}

/**
 * Strips control characters, collapses runs of whitespace, and normalises
 * newlines. Zero-width and bidirectional-override characters are removed
 * because they are used to spoof names and to visually reverse text.
 */
function clean(input: string): string {
  return input
    .normalize("NFC")

    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{3,}/g, "  ")
    .trim();
}

/**
 * Salted digest of the caller's address. The salt is AUTH_SECRET, which is
 * already required and never leaves the server, so the digest cannot be
 * reversed into an IP by anyone reading the table.
 */
export function hashAuthor(address: string | null | undefined): string {
  const salt = getEnv().AUTH_SECRET;
  return createHash("sha256")
    .update(`public-chat:${salt}:${address ?? "unknown"}`)
    .digest("hex")
    .slice(0, 32);
}

export type PostResult =
  { ok: true; message: PublicChatMessageView } | { ok: false; error: string };

export interface ValidationResult {
  ok: boolean;
  error?: string;
  displayName: string;
  body: string;
}

/** Validates and normalises a submission without touching the database. */
export function validateSubmission(rawName: unknown, rawBody: unknown): ValidationResult {
  const displayName = clean(typeof rawName === "string" ? rawName : "");
  const body = clean(typeof rawBody === "string" ? rawBody : "");

  if (displayName.length < MIN_NAME_LENGTH) {
    return {
      ok: false,
      error: `Pick a name of at least ${MIN_NAME_LENGTH} characters.`,
      displayName,
      body,
    };
  }
  if (displayName.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: `Names are limited to ${MAX_NAME_LENGTH} characters.`,
      displayName,
      body,
    };
  }
  if (displayName.includes("\n")) {
    return { ok: false, error: "Names cannot span multiple lines.", displayName, body };
  }
  if (RESERVED_NAME_PATTERNS.some((p) => p.test(displayName))) {
    return {
      ok: false,
      error:
        "That name is reserved — please pick something that can't be mistaken for the league or an admin.",
      displayName,
      body,
    };
  }
  if (body.length === 0) {
    return { ok: false, error: "Say something first.", displayName, body };
  }
  if (body.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      error: `Messages are limited to ${MAX_BODY_LENGTH} characters.`,
      displayName,
      body,
    };
  }
  for (const pattern of blockedPatterns()) {
    if (pattern.test(body) || pattern.test(displayName)) {
      return {
        ok: false,
        error: "That message was blocked by the word filter.",
        displayName,
        body,
      };
    }
  }
  return { ok: true, displayName, body };
}

/** Rate-limit check. Returns an error string when the caller should be refused. */
async function checkRateLimits(authorHash: string): Promise<string | null> {
  const now = Date.now();
  const [recent, last, globalCount] = await Promise.all([
    prisma.publicChatMessage.count({
      where: { authorHash, createdAt: { gte: new Date(now - RATE_LIMIT_WINDOW_MS) } },
    }),
    prisma.publicChatMessage.findFirst({
      where: { authorHash },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, body: true },
    }),
    prisma.publicChatMessage.count({
      where: { createdAt: { gte: new Date(now - GLOBAL_LIMIT_WINDOW_MS) } },
    }),
  ]);

  if (globalCount >= GLOBAL_LIMIT_COUNT) {
    return "The chat is busy right now — try again in a moment.";
  }
  if (recent >= RATE_LIMIT_COUNT) {
    return "You're posting too quickly. Give it a minute.";
  }
  if (last && now - last.createdAt.getTime() < MIN_GAP_MS) {
    return "Slow down a second.";
  }
  return null;
}

function toView(row: {
  id: string;
  displayName: string;
  body: string;
  createdAt: Date;
}): PublicChatMessageView {
  return {
    id: row.id,
    displayName: row.displayName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Posts a message. All validation, moderation and rate limiting happens here. */
export async function postPublicMessage(
  rawName: unknown,
  rawBody: unknown,
  address: string | null | undefined,
): Promise<PostResult> {
  const validation = validateSubmission(rawName, rawBody);
  if (!validation.ok) return { ok: false, error: validation.error ?? "Invalid message." };

  const authorHash = hashAuthor(address);
  const limited = await checkRateLimits(authorHash);
  if (limited) return { ok: false, error: limited };

  // Cheap duplicate guard: the same body twice in a row from one source is
  // almost always a double-submit or a bot.
  const previous = await prisma.publicChatMessage.findFirst({
    where: { authorHash },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  if (previous?.body === validation.body) {
    return { ok: false, error: "You just said that." };
  }

  const created = await prisma.publicChatMessage.create({
    data: { displayName: validation.displayName, body: validation.body, authorHash },
    select: { id: true, displayName: true, body: true, createdAt: true },
  });
  return { ok: true, message: toView(created) };
}

/** The visible feed, oldest first so it reads like a conversation. */
export async function listPublicMessages(limit = FEED_LIMIT): Promise<PublicChatMessageView[]> {
  const rows = await prisma.publicChatMessage.findMany({
    where: { hiddenAt: null },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, FEED_LIMIT),
    select: { id: true, displayName: true, body: true, createdAt: true },
  });
  return rows.reverse().map(toView);
}

/** Admin action: hide a message. Soft delete, so it stays auditable. */
export async function hidePublicMessage(
  id: string,
  adminEmail: string,
  reason = "admin action",
): Promise<void> {
  await prisma.publicChatMessage.update({
    where: { id },
    data: { hiddenAt: new Date(), hiddenBy: adminEmail, hiddenReason: reason },
  });
}

/** Admin action: restore a hidden message. */
export async function restorePublicMessage(id: string): Promise<void> {
  await prisma.publicChatMessage.update({
    where: { id },
    data: { hiddenAt: null, hiddenBy: null, hiddenReason: null },
  });
}

/** Admin view: everything, including hidden, for the moderation screen. */
export async function listAllPublicMessagesForAdmin(limit = 200) {
  return prisma.publicChatMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      displayName: true,
      body: true,
      createdAt: true,
      hiddenAt: true,
      hiddenBy: true,
      hiddenReason: true,
    },
  });
}
