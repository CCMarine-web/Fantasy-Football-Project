// "Receipts" detection + verdict generation.
//
// A receipt is a chat message where someone made a bold prediction / hot take
// ("book it, we're winning the chip") that we later pair with what actually
// happened and hand down a verdict on.
//
// Detection is deliberately two-tier so the feature is demonstrable with the
// MOCK provider (no OPENAI_API_KEY) yet gets much smarter with a real key:
//
//   1. A cheap keyword heuristic pre-filter runs first. It's the ONLY thing
//      that decides isTake when no real AI key is configured — so scanning
//      chat history surfaces plausible receipts locally/on mock. It also keeps
//      bulk scans cheap by never sending obvious non-takes to a provider.
//   2. The short "take summary" is produced by the AI provider when a real key
//      is configured; on mock we fall back to a normalized truncation of the
//      original text (clean, deterministic — no mock gibberish in takeText).
//
// NOTE: real hot-take *classification* (distinguishing a genuine bold
// prediction from someone quoting the word "guarantee") needs OPENAI_API_KEY.
// Without it, treat heuristic hits as candidates for human review — which is
// exactly what the admin Receipts queue is for.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt } from "../prompt-helpers";
import { isAIConfigured } from "@/lib/env";
import type { ContentSafeguards } from "../types";

export const RECEIPT_DETECTION_PROMPT_VERSION = "receipt-detection-v1";
export const RECEIPT_VERDICT_PROMPT_VERSION = "receipt-verdict-v1";

/**
 * Keyword/phrase triggers for the heuristic pre-filter. Matched
 * case-insensitively against the message text. Kept broad on purpose — the
 * human review queue filters false positives, and missing a real take is worse
 * than surfacing a dud.
 */
export const RECEIPT_HEURISTIC_KEYWORDS: readonly string[] = [
  "guarantee",
  "guaranteed",
  "lock",
  "locks",
  "will win",
  "gonna win",
  "no way",
  "calling it",
  "call it now",
  "bold",
  "prediction",
  "predict",
  "trust me",
  "book it",
  "mark my words",
  "easy win",
  "sleeper",
  "bust",
  "screenshot this",
  "remember this",
  "you heard it here",
];

const HEURISTIC_RE = new RegExp(
  `\\b(?:${RECEIPT_HEURISTIC_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

/** True when the text trips the keyword pre-filter. Exported for testing/reuse. */
export function matchesTakeHeuristic(text: string): boolean {
  return HEURISTIC_RE.test(text);
}

/** Collapse whitespace and truncate to a tidy one-liner for takeText fallback. */
function normalizeTake(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 200 ? `${collapsed.slice(0, 197)}…` : collapsed;
}

const DETECTION_SYSTEM_PROMPT = `You are helping curate "Receipts" for a fantasy football league newspaper. A receipt is a message where someone makes a BOLD prediction or confident hot take about the league — a guarantee, a called shot, a smack-talk claim that can later be proven right or wrong. Given ONE chat message, decide if it is such a take. Reply with a single short line: the normalized take in under 20 words if it IS a bold take, or exactly "NO" if it is not. No preamble, no quotes.`;

export interface ReceiptDetection {
  isTake: boolean;
  /** A short normalized version of the take (empty when isTake is false). */
  takeSummary: string;
}

/**
 * Decides whether a message is a bold take and returns a short summary.
 *
 * Heuristic gates `isTake` (so it works on mock); the AI, when configured,
 * refines the summary. A heuristic miss short-circuits to `{ isTake: false }`
 * without any AI call, which matters when scanning years of history.
 */
export async function detectReceipt(
  messageText: string,
  safeguards: ContentSafeguards,
): Promise<ReceiptDetection> {
  const text = (messageText ?? "").trim();
  if (!text) return { isTake: false, takeSummary: "" };

  if (!matchesTakeHeuristic(text)) {
    return { isTake: false, takeSummary: "" };
  }

  // Heuristic hit → candidate take. Without a real key we keep the original
  // (normalized) text as the summary; with a key we ask the model to tighten
  // it and confirm — but a heuristic hit still counts as a take for review.
  if (!isAIConfigured()) {
    return { isTake: true, takeSummary: normalizeTake(text) };
  }

  try {
    const systemPrompt = buildSystemPrompt(DETECTION_SYSTEM_PROMPT, safeguards);
    const result = await getAIProvider().generate({
      promptVersion: RECEIPT_DETECTION_PROMPT_VERSION,
      systemPrompt,
      userPrompt: text,
      humorLevel: safeguards.humorLevel,
      maxOutputTokens: 60,
    });
    const out = result.text.trim();
    if (out.toUpperCase() === "NO" || out.length === 0) {
      return { isTake: false, takeSummary: "" };
    }
    return { isTake: true, takeSummary: normalizeTake(out) };
  } catch {
    // If the provider errors, don't lose the candidate — fall back to heuristic.
    return { isTake: true, takeSummary: normalizeTake(text) };
  }
}

const VERDICT_SYSTEM_PROMPT = `You are the staff writer for "The Rat Trap", a fantasy football league newspaper, running a "Receipts" column. Given a bold TAKE someone made and the OUTCOME of what actually happened, write ONE judgmental, punchy sentence (max ~30 words) rendering a verdict — vindication if they nailed it, ridicule if it aged like milk. Plain prose, no JSON, no preamble.`;

/**
 * A one-liner pairing a take with its outcome. Safe on mock (returns mock
 * text); the weekly/backfill flow should refresh these with a real provider.
 */
export async function generateReceiptVerdict(
  take: string,
  outcome: string,
  safeguards: ContentSafeguards,
): Promise<string> {
  const systemPrompt = buildSystemPrompt(VERDICT_SYSTEM_PROMPT, safeguards);
  const userPrompt = [`TAKE: ${take.trim()}`, `OUTCOME: ${outcome.trim()}`].join("\n");
  const result = await getAIProvider().generate({
    promptVersion: RECEIPT_VERDICT_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 80,
  });
  return result.text.trim();
}
