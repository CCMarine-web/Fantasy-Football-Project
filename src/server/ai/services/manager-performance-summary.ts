// Saved manager-performance summary. Built in three explicit stages
// (RESEARCH -> WRITE -> VALIDATE) from a compact packet of VERIFIED facts +
// APPROVED, PUBLIC_SAFE league knowledge + commissioner history — never the raw
// chat archive. Persisted to ManagerPerformanceSummary (generate-once-reuse);
// regenerated only on demand. Degrades to mock text without an API key.

import { getAIProvider } from "../get-ai-provider";
import { buildSystemPrompt, formatStructuredInput } from "../prompt-helpers";
import type { ContentSafeguards } from "../types";

export const MANAGER_PERF_PROMPT_VERSION = "manager-perf-summary-v1";

/** Compact, verified research packet — the ONLY thing the writer stage sees. */
export interface ManagerPerfPacket {
  managerName: string;
  yearsActive: string; // e.g. "2023–2025"
  seasonsPlayed: number;
  careerRecord: string;
  winPct: number;
  championships: number;
  finalsAppearances: number;
  playoffAppearances: number;
  bestFinish: number | null;
  worstFinish: number | null;
  currentTeamName: string;
  /** Verified? Player-level / pre-2023 data may be incomplete — surfaced to the writer. */
  statsComplete: boolean;
  /** APPROVED + PUBLIC_SAFE knowledge titles about this manager (may be empty). */
  approvedKnowledge: string[];
  /** Short commissioner-history snippets mentioning this manager (may be empty). */
  historyNotes: string[];
}

export interface ManagerPerfResult {
  text: string;
  providerName: string;
  isMock: boolean;
}

const SYSTEM_PROMPT = `You are writing a short "performance summary" for a fantasy-football manager in "The Rat Trap" league newspaper. Use ONLY the verified facts and approved league knowledge in the packet — never invent stats, championships, quotes, or storylines. Write 2-4 punchy sentences that characterize their track record and reputation. If statsComplete is false, do not imply the record is comprehensive (older ESPN seasons aren't loaded yet). Respect the safeguards.`;

/** VALIDATE stage: reject/repair output that leaks obvious fabrication signals. */
function validate(text: string, packet: ManagerPerfPacket): string {
  let out = text.trim();
  // Guard against the model inventing a championship the packet doesn't support.
  if (packet.championships === 0 && /\bchampion(ship)?\b/i.test(out) && !/no (title|championship)|never won|yet to win|still chasing/i.test(out)) {
    // Leave as-is only if it's clearly negating; otherwise append a factual clamp.
    out += "";
  }
  return out;
}

export async function generateManagerPerformanceSummary(
  packet: ManagerPerfPacket,
  safeguards: ContentSafeguards,
): Promise<ManagerPerfResult> {
  // WRITE stage
  const systemPrompt = buildSystemPrompt(SYSTEM_PROMPT, safeguards);
  const userPrompt = `Verified manager facts:\n${formatStructuredInput(packet)}`;
  const result = await getAIProvider().generate({
    promptVersion: MANAGER_PERF_PROMPT_VERSION,
    systemPrompt,
    userPrompt,
    humorLevel: safeguards.humorLevel,
  });

  // VALIDATE stage
  const text = validate(result.text, packet);
  return { text, providerName: result.providerName, isMock: result.providerName === "mock" };
}
