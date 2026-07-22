// Proposes LeagueKnowledge (traits, rivalries, jokes, quotes, events) from a
// grouped conversation. Staged: the conversation transcript is the RESEARCH
// packet; the model WRITES structured proposals; we VALIDATE/parse them into
// typed rows. Every proposal is admin-only (PENDING) + PRIVATE by default and
// carries supporting message IDs. Returns [] on the mock provider (no key), so
// nothing garbage is ever written locally.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt } from "../prompt-helpers";
import type { AIUsage, ContentSafeguards } from "../types";
import type { Conversation } from "@/server/lore/conversation-grouping";
import type { KnowledgeType, PrivacyStatus } from "@/generated/prisma/client";

export const KNOWLEDGE_EXTRACTION_PROMPT_VERSION = "knowledge-extraction-v1";

const VALID_TYPES: KnowledgeType[] = [
  "PERSONALITY_TRAIT", "DRAFT_TENDENCY", "TRADE_TENDENCY", "WAIVER_TENDENCY", "RIVALRY",
  "INSIDE_JOKE", "NICKNAME", "QUOTE", "FAILED_PREDICTION", "MEMORABLE_MOMENT",
  "PLAYOFF_COLLAPSE", "DRAFT_DISASTER", "TRADE_REGRET", "CHAMPIONSHIP_STORY",
  "TRADITION", "STORYLINE",
];

export interface KnowledgeProposal {
  knowledgeType: KnowledgeType;
  title: string;
  body: string;
  managerNames: string[];
  confidence: number;
  privacyStatus: PrivacyStatus;
  evidenceMessageIds: string[];
}

const SYSTEM_PROMPT = `You analyze a private fantasy-football group-chat conversation and propose durable "league knowledge" for a newspaper's research database. Propose ONLY things supported by repeated or clearly-stated evidence in THIS conversation — never infer a manager's whole personality from a single throwaway line. For each item output: type, a short title, a 1-2 sentence body, the managers it's about, a confidence 0-1, and a privacyStatus (PUBLIC_SAFE for lighthearted/printable, PRIVATE for sensitive personal matters, NEVER_PUBLISH for anything genuinely private or hurtful). Prefer fewer, higher-quality items. Respect the safeguards.`;

/** Attempt to parse a JSON array of proposals out of a model response. */
function parseProposals(text: string, conv: Conversation): KnowledgeProposal[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: KnowledgeProposal[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const type = String(o.type ?? o.knowledgeType ?? "").toUpperCase() as KnowledgeType;
    if (!VALID_TYPES.includes(type)) continue;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const body = typeof o.body === "string" ? o.body.trim() : "";
    if (!title || !body) continue;
    const privacy = String(o.privacyStatus ?? "PRIVATE").toUpperCase();
    const privacyStatus: PrivacyStatus =
      privacy === "PUBLIC_SAFE" ? "PUBLIC_SAFE" : privacy === "NEVER_PUBLISH" ? "NEVER_PUBLISH" : "PRIVATE";
    out.push({
      knowledgeType: type,
      title: title.slice(0, 160),
      body: body.slice(0, 1000),
      managerNames: Array.isArray(o.managerNames) ? o.managerNames.map(String) : [],
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0.5)),
      privacyStatus,
      // Evidence: default to all messages in the conversation (the admin narrows it).
      evidenceMessageIds: conv.messageIds,
    });
  }
  return out;
}

export async function extractKnowledgeFromConversation(
  conv: Conversation,
  safeguards: ContentSafeguards,
  opts: { model?: string } = {},
): Promise<{ proposals: KnowledgeProposal[]; isMock: boolean; usage?: AIUsage }> {
  if (conv.transcript.length < 80) return { proposals: [], isMock: false };
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Conversation transcript (${conv.messageCount} messages):\n${conv.transcript}\n\nReturn ONLY a JSON array of proposals (may be empty).`;

  const result = await getAIProvider().generate({
    promptVersion: KNOWLEDGE_EXTRACTION_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 2000,
    reasoningEffort: "low",
    model: opts.model,
  });
  if (result.providerName === "mock") return { proposals: [], isMock: true };
  return { proposals: parseProposals(result.text, conv), isMock: false, usage: result.usage };
}
