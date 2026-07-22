// Private, admin-only personality + communication profile for one manager.
// Staged: the packet (distilled knowledge about the manager + a BOUNDED sample
// of their own messages for voice + verified career stats) is the RESEARCH; the
// model WRITES a structured profile; we VALIDATE/parse it into typed fields.
// The output is PRIVATE (never public) and is used only as tone/voice guidance
// for AI generation. Returns a mock marker without an API key so nothing garbage
// is ever persisted.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { AIUsage, ContentSafeguards } from "../types";

export const MANAGER_COMM_PROFILE_PROMPT_VERSION = "manager-comm-profile-v1";

/** Compact research packet — the ONLY thing the writer stage sees. */
export interface ManagerCommPacket {
  managerName: string;
  /** e.g. "2023–2026" */
  yearsActive: string;
  careerRecord: string;
  championships: number;
  /** Distilled knowledge about this manager (traits, jokes, quotes, tendencies). */
  knowledge: { type: string; title: string; body: string }[];
  /** A BOUNDED, representative sample of the manager's own chat lines (voice). */
  messageSamples: string[];
  /** How many total messages this manager has in the archive (context for the writer). */
  totalMessages: number;
}

export interface ManagerCommFacets {
  tone: string;
  humorStyle: string;
  catchphrases: string[];
  favoriteTopics: string[];
  trashTalkStyle: string;
}

export interface ManagerCommResult {
  profile: string;
  styleSummary: string;
  facets: ManagerCommFacets | null;
  providerName: string;
  model: string;
  isMock: boolean;
  usage?: AIUsage;
}

const SYSTEM_PROMPT = `You build a PRIVATE, admin-only "communication profile" for one fantasy-football manager, from their group-chat history. This is internal research so a newspaper's AI writer can capture each manager's voice — it is never shown publicly. Describe HOW they communicate: tone, humor style, verbal tics/catchphrases, recurring topics, and how they trash-talk or argue. Base every claim on repeated, clearly-evidenced patterns in the packet — never invent a trait from a single line, and never speculate about their private life, health, finances, or anything outside the league. Keep it about football-chat personality.

Return ONLY a JSON object:
{
  "profile": "3-6 sentence narrative of how this person communicates in the league chat",
  "styleSummary": "one short line, e.g. 'dry, meme-heavy, quick to needle rivals'",
  "facets": {
    "tone": "...",
    "humorStyle": "...",
    "catchphrases": ["..."],
    "favoriteTopics": ["..."],
    "trashTalkStyle": "..."
  }
}
Respect the safeguards below.`;

/** Parse the JSON object out of a model response; tolerant of code fences / prose. */
function parseProfile(text: string): { profile: string; styleSummary: string; facets: ManagerCommFacets | null } | null {
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
  const profile = typeof o.profile === "string" ? o.profile.trim() : "";
  if (!profile) return null;
  const styleSummary = typeof o.styleSummary === "string" ? o.styleSummary.trim().slice(0, 200) : "";
  let facets: ManagerCommFacets | null = null;
  if (o.facets && typeof o.facets === "object") {
    const f = o.facets as Record<string, unknown>;
    const strArr = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 8) : []);
    facets = {
      tone: typeof f.tone === "string" ? f.tone : "",
      humorStyle: typeof f.humorStyle === "string" ? f.humorStyle : "",
      catchphrases: strArr(f.catchphrases),
      favoriteTopics: strArr(f.favoriteTopics),
      trashTalkStyle: typeof f.trashTalkStyle === "string" ? f.trashTalkStyle : "",
    };
  }
  return { profile: profile.slice(0, 4000), styleSummary, facets };
}

export async function generateManagerCommunicationProfile(
  packet: ManagerCommPacket,
  safeguards: ContentSafeguards,
  opts: { model?: string } = {},
): Promise<ManagerCommResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Manager: ${packet.managerName}\nActive: ${packet.yearsActive} | Record: ${packet.careerRecord} | Championships: ${packet.championships}\nTotal chat messages: ${packet.totalMessages}\n\nDistilled knowledge about them:\n${formatStructuredInput(packet.knowledge)}\n\nRepresentative message samples (their own lines):\n${packet.messageSamples.map((m) => `- ${m}`).join("\n")}\n\nReturn ONLY the JSON object described above.`;

  const result = await getAIProvider().generate({
    promptVersion: MANAGER_COMM_PROFILE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 2500,
    reasoningEffort: "low",
    model: opts.model,
  });

  if (result.providerName === "mock") {
    return { profile: "", styleSummary: "", facets: null, providerName: "mock", model: result.model, isMock: true };
  }
  const parsed = parseProfile(result.text);
  if (!parsed) {
    // Model returned unparseable text — surface the raw text as the profile so
    // nothing is silently lost, but keep facets null.
    return {
      profile: result.text.trim().slice(0, 4000),
      styleSummary: "",
      facets: null,
      providerName: result.providerName,
      model: result.model,
      isMock: false,
      usage: result.usage,
    };
  }
  return { ...parsed, providerName: result.providerName, model: result.model, isMock: false, usage: result.usage };
}
