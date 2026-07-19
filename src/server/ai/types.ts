// Provider-agnostic AI content architecture — shared types.
//
// Nothing in this file (or anywhere under src/server/ai/) talks to Prisma or
// the network directly except log-generation.ts (Prisma) and
// openai-provider.ts (fetch). Everything else is plain data in, plain text
// out, which is what keeps this module testable and swappable.

/** Humor dial: 1 = dry/factual, 5 = full roast (see prompt-helpers.ts for the copy). */
export type HumorLevel = 1 | 2 | 3 | 4 | 5;

/**
 * Cross-cutting content-safety knobs every content-service function must
 * accept and fold into its prompt. These map directly onto League/Manager
 * fields (League.defaultHumorLevel, League.sensitiveTopics, Manager.noRoast)
 * but the caller is responsible for resolving those into this plain shape —
 * this module never queries Prisma for them.
 */
export interface ContentSafeguards {
  /** 1-5. Callers should default this to League.defaultHumorLevel. */
  humorLevel: number;
  /** Topics/strings the model must not reference, joke about, or allude to. */
  sensitiveTopics: string[];
  /** Display names of managers with Manager.noRoast = true. Mentions of these
   *  managers must stay strictly factual/neutral — never the target of a joke. */
  noRoastManagerNames: string[];
}

/** A single request to an AI provider. Provider-agnostic — no OpenAI-specific shape leaks in here. */
export interface AIGenerationRequest {
  /** Version tag for the prompt template that produced this request, e.g. "matchup-preview-v1". */
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  /** 1-5. Carried alongside the prompts mainly so providers/logs can record it without re-deriving it. */
  humorLevel: number;
  maxOutputTokens?: number;
}

/** What every provider hands back, regardless of how it produced the text. */
export interface AIGenerationResult {
  text: string;
  /** e.g. "openai" | "mock" */
  providerName: string;
  model: string;
}

/** Implemented by MockAIProvider and OpenAIProvider. Callers should obtain an
 *  instance via getAIProvider() rather than constructing one directly. */
export interface AIProvider {
  generate(request: AIGenerationRequest): Promise<AIGenerationResult>;
}
