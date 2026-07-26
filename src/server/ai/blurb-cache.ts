// Read/write helpers for AIBlurbCache — the short AI commentary that used to
// be generated on every page render (power rankings, rivalries, trade
// verdicts).
//
// The rule this enforces: PAGES READ, SCRIPTS WRITE. Rendering a page never
// calls a model. A blurb is written once by scripts/ai/backfill-blurbs.ts,
// keyed by a hash of the verified numbers it describes, and reused until those
// numbers change. Mock output is never stored, so a page shows either real
// copy or an honest empty state.

import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";

export type BlurbKind = "POWER_RANKING" | "RIVALRY" | "TRADE_VERDICT";

/** Stable fingerprint of whatever facts a blurb was written from. */
export function hashInputs(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

export interface CachedBlurb {
  text: string;
  /** True when the cached copy predates the current numbers. */
  stale: boolean;
}

/**
 * Fetches cached blurbs for many subjects at once (one query, no N+1).
 * Returns a map of subjectKey -> blurb. Callers pass the CURRENT input hash
 * per subject so stale entries can be flagged; a stale blurb is still returned
 * (better than a blank space) but the backfill script will rewrite it.
 */
export async function getBlurbs(
  kind: BlurbKind,
  subjects: { subjectKey: string; inputHash: string }[],
): Promise<Map<string, CachedBlurb>> {
  if (subjects.length === 0) return new Map();

  const rows = await prisma.aIBlurbCache.findMany({
    where: { kind, subjectKey: { in: subjects.map((s) => s.subjectKey) } },
    select: { subjectKey: true, text: true, inputHash: true },
  });

  const wanted = new Map(subjects.map((s) => [s.subjectKey, s.inputHash]));
  const out = new Map<string, CachedBlurb>();
  for (const r of rows) {
    out.set(r.subjectKey, { text: r.text, stale: wanted.get(r.subjectKey) !== r.inputHash });
  }
  return out;
}

/**
 * Stores a blurb. Refuses mock text outright — caching placeholder copy is how
 * the old code ended up serving "[MOCK AI CONTENT]" forever.
 */
export async function putBlurb(args: {
  kind: BlurbKind;
  subjectKey: string;
  inputHash: string;
  text: string;
  providerName: string;
  model: string;
}): Promise<boolean> {
  const text = args.text.trim();
  if (!text) return false;
  if (args.providerName === "mock" || text.includes("[MOCK AI CONTENT]")) return false;

  await prisma.aIBlurbCache.upsert({
    where: { kind_subjectKey: { kind: args.kind, subjectKey: args.subjectKey } },
    create: {
      kind: args.kind,
      subjectKey: args.subjectKey,
      inputHash: args.inputHash,
      text,
      providerName: args.providerName,
      model: args.model,
    },
    update: {
      inputHash: args.inputHash,
      text,
      providerName: args.providerName,
      model: args.model,
    },
  });
  return true;
}
