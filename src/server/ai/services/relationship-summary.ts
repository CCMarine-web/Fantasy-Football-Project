// Private, admin-only narrative summary of the relationship between TWO
// managers (rivalry, friendship, running feuds/inside jokes). Staged: the packet
// (head-to-head record + knowledge mentioning both + a BOUNDED sample of their
// cross-talk) is the RESEARCH; the model classifies the relationship and WRITES
// a short summary; we VALIDATE/parse it. Output is PRIVATE and used only as
// context for AI generation — there is no public relationship page.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { AIUsage, ContentSafeguards } from "../types";
import type { RelationshipType } from "@/generated/prisma/client";

export const RELATIONSHIP_PROMPT_VERSION = "relationship-summary-v1";

const VALID_TYPES: RelationshipType[] = [
  "RIVALRY", "FRIENDSHIP", "ALLIANCE", "ANTAGONISM", "MIXED", "NEUTRAL",
];

export interface RelationshipPacket {
  managerAName: string;
  managerBName: string;
  /** Head-to-head from A's perspective, e.g. "7-4" (A wins - B wins). */
  headToHead: string;
  playoffMeetings: number;
  /** Knowledge items that mention both managers. */
  sharedKnowledge: { type: string; title: string; body: string }[];
  /** BOUNDED sample of chat lines where the two interact (sender: text). */
  interactionSamples: string[];
}

export interface RelationshipResult {
  relationshipType: RelationshipType;
  summary: string;
  intensity: number;
  providerName: string;
  model: string;
  isMock: boolean;
  usage?: AIUsage;
}

const SYSTEM_PROMPT = `You summarize the PRIVATE, admin-only relationship between two fantasy-football managers using their group-chat history and head-to-head record. This is internal research for a newspaper's AI writer — never shown publicly. Classify the relationship and describe it in 2-3 sentences: are they rivals, friends, frequent antagonists, allies who scheme together, or a mix? Note any running feuds, inside jokes, or recurring dynamics between the two — but ONLY things clearly evidenced by repeated patterns. Never invent drama, and never touch anything outside the league (no personal life, health, finances).

Return ONLY a JSON object:
{
  "relationshipType": "RIVALRY | FRIENDSHIP | ALLIANCE | ANTAGONISM | MIXED | NEUTRAL",
  "summary": "2-3 sentences",
  "intensity": 0.0-1.0
}
Respect the safeguards below.`;

function parseResult(text: string): { relationshipType: RelationshipType; summary: string; intensity: number } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  if (!summary) return null;
  const t = String(o.relationshipType ?? "MIXED").toUpperCase() as RelationshipType;
  const relationshipType = VALID_TYPES.includes(t) ? t : "MIXED";
  const intensity = Math.max(0, Math.min(1, Number(o.intensity) || 0.5));
  return { relationshipType, summary: summary.slice(0, 1200), intensity };
}

export async function generateRelationshipSummary(
  packet: RelationshipPacket,
  safeguards: ContentSafeguards,
  opts: { model?: string } = {},
): Promise<RelationshipResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Managers: ${packet.managerAName} vs ${packet.managerBName}\nHead-to-head (${packet.managerAName} - ${packet.managerBName}): ${packet.headToHead} | Playoff meetings: ${packet.playoffMeetings}\n\nShared knowledge:\n${formatStructuredInput(packet.sharedKnowledge)}\n\nInteraction samples:\n${packet.interactionSamples.map((m) => `- ${m}`).join("\n")}\n\nReturn ONLY the JSON object described above.`;

  const result = await getAIProvider().generate({
    promptVersion: RELATIONSHIP_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 1600,
    reasoningEffort: "low",
    model: opts.model,
  });

  if (result.providerName === "mock") {
    return { relationshipType: "MIXED", summary: "", intensity: 0.5, providerName: "mock", model: result.model, isMock: true };
  }
  const parsed = parseResult(result.text);
  if (!parsed) {
    return { relationshipType: "MIXED", summary: result.text.trim().slice(0, 1200), intensity: 0.5, providerName: result.providerName, model: result.model, isMock: false, usage: result.usage };
  }
  return { ...parsed, providerName: result.providerName, model: result.model, isMock: false, usage: result.usage };
}
