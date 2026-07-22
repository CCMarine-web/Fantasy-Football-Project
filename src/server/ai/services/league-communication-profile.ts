// Singleton, admin-only league-wide voice profile: overall humor + communication
// style, group dynamics, traditions, and useful historical context. Staged: the
// packet (aggregated distilled knowledge + per-manager style taglines +
// commissioner-history titles) is the RESEARCH; the model WRITES the profile; we
// VALIDATE/parse it into typed sections. Feeds every AI generation as tone/voice
// guidance. Mock-safe. This is internal research, not a public page.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { AIUsage, ContentSafeguards } from "../types";

export const LEAGUE_PROFILE_PROMPT_VERSION = "league-comm-profile-v1";

export interface LeagueProfilePacket {
  leagueName: string;
  seasonsCovered: string;
  managerCount: number;
  /** Per-manager one-line style taglines. */
  managerStyles: { name: string; style: string }[];
  /** Aggregated distilled knowledge, especially TRADITION / INSIDE_JOKE / STORYLINE / RIVALRY. */
  knowledge: { type: string; title: string; body: string }[];
  /** Commissioner-history section titles (verified narrative). */
  historyTitles: string[];
}

export interface LeagueProfileSections {
  humorStyle: string;
  communicationStyle: string;
  dynamics: string;
  traditions: string;
  historicalContext: string;
}

export interface LeagueProfileResult extends LeagueProfileSections {
  facets: Record<string, unknown> | null;
  providerName: string;
  model: string;
  isMock: boolean;
  usage?: AIUsage;
}

const SYSTEM_PROMPT = `You write a PRIVATE, admin-only "league voice profile" for a fantasy-football league newspaper's AI writer. Using the aggregated research packet (each manager's communication style, distilled league knowledge, traditions, running jokes, storylines, and commissioner history), describe the league's collective character so generated content sounds authentic. Base every claim on the evidence in the packet — never invent traditions, jokes, or history. Keep it about the league and its football banter, nothing personal or outside the game.

Return ONLY a JSON object with these string fields:
{
  "humorStyle": "how the group jokes collectively (2-4 sentences)",
  "communicationStyle": "how they communicate — pace, formats (memes, gifs), tone (2-4 sentences)",
  "dynamics": "group dynamics: cliques, loudest voices, quiet ones, who instigates (2-4 sentences)",
  "traditions": "recurring traditions, bits, annual events evidenced in the chat (2-4 sentences)",
  "historicalContext": "useful historical context the writer should know (2-4 sentences)"
}
Respect the safeguards below.`;

const SECTION_KEYS: (keyof LeagueProfileSections)[] = [
  "humorStyle", "communicationStyle", "dynamics", "traditions", "historicalContext",
];

function parseSections(text: string): LeagueProfileSections | null {
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
  const out = {} as LeagueProfileSections;
  let any = false;
  for (const k of SECTION_KEYS) {
    const v = typeof o[k] === "string" ? (o[k] as string).trim().slice(0, 2000) : "";
    out[k] = v;
    if (v) any = true;
  }
  return any ? out : null;
}

export async function generateLeagueCommunicationProfile(
  packet: LeagueProfilePacket,
  safeguards: ContentSafeguards,
  opts: { model?: string } = {},
): Promise<LeagueProfileResult> {
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `League: ${packet.leagueName} | Seasons: ${packet.seasonsCovered} | Managers: ${packet.managerCount}\n\nPer-manager styles:\n${packet.managerStyles.map((m) => `- ${m.name}: ${m.style}`).join("\n")}\n\nDistilled league knowledge:\n${formatStructuredInput(packet.knowledge)}\n\nCommissioner history sections:\n${packet.historyTitles.map((t) => `- ${t}`).join("\n")}\n\nReturn ONLY the JSON object described above.`;

  const result = await getAIProvider().generate({
    promptVersion: LEAGUE_PROFILE_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
    maxOutputTokens: 3000,
    reasoningEffort: "low",
    model: opts.model,
  });

  const empty: LeagueProfileSections = {
    humorStyle: "", communicationStyle: "", dynamics: "", traditions: "", historicalContext: "",
  };

  if (result.providerName === "mock") {
    return { ...empty, facets: null, providerName: "mock", model: result.model, isMock: true };
  }
  const parsed = parseSections(result.text);
  if (!parsed) {
    return { ...empty, historicalContext: result.text.trim().slice(0, 2000), facets: null, providerName: result.providerName, model: result.model, isMock: false, usage: result.usage };
  }
  return { ...parsed, facets: null, providerName: result.providerName, model: result.model, isMock: false, usage: result.usage };
}
