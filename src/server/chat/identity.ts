import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";

/**
 * WHO MAY CALL THEMSELVES WHAT on the public shoutbox.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 * The shoutbox has no accounts, by design — anyone with the link can post. That
 * is fine for "Xanos" and "EvilJuan". It is not fine for "Michael Shea", and
 * somebody duly posted a confession under his name. A league newspaper that
 * prints impersonations of its own members is worse than one with no chat.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * Every real identity in the league is RESERVED: manager display names, every
 * recorded alias, and every team name a manager has ever used. Posting under
 * one requires that manager's personal chat code. Presenting it does two
 * things: it lets the name through, and it marks the message as verified.
 *
 * Everything else stays open. An anonymous visitor can be anyone they like as
 * long as it is not somebody real.
 *
 * ── Matching ──────────────────────────────────────────────────────────────
 * Names are compared after normalising to lowercase alphanumerics, so
 * "Michael Shea", "michaelshea", "M-i-c-h-a-e-l  S-h-e-a" and "MichaelShea!"
 * are one name. Short aliases are excluded: "yo" is a team name ("Team yo")
 * and reserving every fragment would refuse half the harmless names people
 * actually pick.
 */

/** Aliases shorter than this are not reserved — see above. */
const MIN_RESERVED_LENGTH = 4;

/** Lowercase alphanumerics only, so decoration cannot dodge a reservation. */
export function normaliseName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export interface ReservedName {
  normalised: string;
  /** The manager it belongs to, so the refusal can name the right code. */
  managerId: string;
  managerName: string;
  /** What kind of name it is, for the error message. */
  source: "manager" | "alias" | "team";
}

/**
 * Every name that belongs to a real person: display names, aliases, and team
 * names. Read fresh on each check — a manager who changes their team name is
 * protected from the next message onward, not the next deploy.
 */
export async function loadReservedNames(): Promise<Map<string, ReservedName>> {
  const [managers, teams] = await Promise.all([
    prisma.manager.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        displayName: true,
        nickname: true,
        aliases: { select: { value: true } },
      },
    }),
    prisma.fantasyTeam.findMany({
      select: { teamName: true, managerId: true, manager: { select: { displayName: true } } },
    }),
  ]);

  const reserved = new Map<string, ReservedName>();
  const add = (raw: string | null, managerId: string, managerName: string, source: ReservedName["source"]) => {
    if (!raw) return;
    const normalised = normaliseName(raw);
    if (normalised.length < MIN_RESERVED_LENGTH) return;
    // First writer wins, so a manager's own display name outranks a team name
    // that happens to normalise the same way.
    if (!reserved.has(normalised)) {
      reserved.set(normalised, { normalised, managerId, managerName, source });
    }
  };

  for (const m of managers) {
    add(m.displayName, m.id, m.displayName, "manager");
    add(m.nickname, m.id, m.displayName, "alias");
    for (const alias of m.aliases) add(alias.value, m.id, m.displayName, "alias");
  }
  for (const t of teams) {
    add(t.teamName, t.managerId, t.manager.displayName, "team");
  }
  return reserved;
}

// ---------------------------------------------------------------------------
// Manager chat codes
// ---------------------------------------------------------------------------

/**
 * Hash of a chat code. Salted with AUTH_SECRET so a database leak does not hand
 * anyone the codes, and so a code cannot be tested offline without the server
 * secret.
 */
export function hashChatCode(code: string): string {
  const salt = getEnv().AUTH_SECRET;
  return createHash("sha256").update(`chat-code:${salt}:${code.trim()}`).digest("hex");
}

/** Constant-time comparison, so a wrong code cannot be narrowed down by timing. */
function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * A readable code: four groups of four from an unambiguous alphabet. No O/0,
 * I/1/l — these get read aloud and typed on phones.
 */
export function generateChatCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)]
    .map((group) => group.join(""))
    .join("-");
}

export interface VerifiedManager {
  id: string;
  displayName: string;
}

/**
 * Resolves a supplied chat code to the manager it belongs to, or null.
 *
 * Every manager with a code set is checked, so a manager can post under any of
 * their own names (display name, nickname, an old team name) with the one code.
 */
export async function resolveChatCode(code: string): Promise<VerifiedManager | null> {
  const trimmed = code.trim();
  if (trimmed.length === 0) return null;
  const hash = hashChatCode(trimmed);
  const candidates = await prisma.manager.findMany({
    where: { chatCodeHash: { not: null }, deletedAt: null },
    select: { id: true, displayName: true, chatCodeHash: true },
  });
  for (const m of candidates) {
    if (m.chatCodeHash && hashesMatch(m.chatCodeHash, hash)) {
      return { id: m.id, displayName: m.displayName };
    }
  }
  return null;
}

/** Admin action: issue a new code. Returns the plaintext ONCE; it is not stored. */
export async function issueChatCode(managerId: string): Promise<string> {
  const code = generateChatCode();
  await prisma.manager.update({
    where: { id: managerId },
    data: { chatCodeHash: hashChatCode(code) },
  });
  return code;
}

/** Admin action: revoke a manager's code, re-reserving their name outright. */
export async function revokeChatCode(managerId: string): Promise<void> {
  await prisma.manager.update({ where: { id: managerId }, data: { chatCodeHash: null } });
}

// ---------------------------------------------------------------------------
// Moderation rules
// ---------------------------------------------------------------------------

export interface ModerationState {
  /** Normalised names an admin has blocked outright. */
  blockedNames: Set<string>;
  /** Author digests an admin has muted, with any expiry already applied. */
  mutedAuthors: Set<string>;
}

export async function loadModerationState(): Promise<ModerationState> {
  const now = new Date();
  const rules = await prisma.chatModerationRule.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { kind: true, value: true },
  });
  return {
    blockedNames: new Set(rules.filter((r) => r.kind === "BLOCKED_NAME").map((r) => r.value)),
    mutedAuthors: new Set(rules.filter((r) => r.kind === "MUTED_AUTHOR").map((r) => r.value)),
  };
}

export async function addModerationRule(input: {
  kind: "BLOCKED_NAME" | "MUTED_AUTHOR";
  value: string;
  reason?: string | null;
  createdBy?: string | null;
  expiresAt?: Date | null;
}): Promise<void> {
  // Blocked names are stored normalised so the rule catches every decoration of
  // the name rather than the one spelling the admin happened to see.
  const value = input.kind === "BLOCKED_NAME" ? normaliseName(input.value) : input.value.trim();
  if (!value) return;
  await prisma.chatModerationRule.upsert({
    where: { kind_value: { kind: input.kind, value } },
    update: {
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    create: {
      kind: input.kind,
      value,
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export async function removeModerationRule(id: string): Promise<void> {
  await prisma.chatModerationRule.deleteMany({ where: { id } });
}

export async function listModerationRules() {
  return prisma.chatModerationRule.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
}
