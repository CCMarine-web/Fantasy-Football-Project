// Real provider — plain fetch() against the OpenAI Chat Completions API. No
// `openai` npm dependency on purpose (spec: keep the dependency footprint
// down); the request/response shapes we need are small and stable.

import { getEnv } from "@/lib/env";
import type { AIGenerationRequest, AIGenerationResult, AIProvider } from "./types";

const CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

/** Thrown on any non-2xx response from the OpenAI API, so callers can
 *  distinguish "AI provider failed" from other errors (e.g. to fall back to
 *  the mock provider, surface a retry button, etc). */
export class OpenAIProviderError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`OpenAI API request failed with status ${status}: ${body.slice(0, 500)}`);
    this.name = "OpenAIProviderError";
    this.status = status;
    this.body = body;
  }
}

interface ChatCompletionsResponse {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenAIProvider implements AIProvider {
  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const env = getEnv();
    const apiKey = env.OPENAI_API_KEY;
    // Per-call override wins; otherwise fall back to the configured default.
    const model = request.model?.trim() || env.OPENAI_MODEL;

    if (!apiKey.trim()) {
      // Should not happen in practice — getAIProvider() only hands out this
      // provider when isAIConfigured() is true — but fail loudly if it does.
      throw new OpenAIProviderError(0, "OPENAI_API_KEY is not configured");
    }

    const response = await fetch(CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt },
        ],
        ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OpenAIProviderError(response.status, body);
    }

    const data = (await response.json()) as ChatCompletionsResponse;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";

    /*
     * Empty content is a FAILURE, not a result.
     *
     * The gpt-5 family spends `max_completion_tokens` on reasoning first, so a
     * budget that is generous for the prose but tight for the reasoning comes
     * back with finish_reason "length" and content "". Returning that as text
     * used to look like a successful generation: six manager profiles were
     * overwritten with an empty string and saved, and the pages rendered a blank
     * biography section. Failing loudly here means the caller keeps whatever it
     * already had.
     */
    if (text.trim().length === 0) {
      throw new OpenAIProviderError(
        response.status,
        `model returned no content (finish_reason: ${choice?.finish_reason ?? "unknown"}, ` +
          `completion_tokens: ${data.usage?.completion_tokens ?? "?"}, ` +
          `max_completion_tokens: ${request.maxOutputTokens ?? "unset"}). ` +
          `With a reasoning model this almost always means the token budget was consumed ` +
          `by reasoning — raise maxOutputTokens or lower reasoningEffort.`,
      );
    }

    const usage =
      data.usage && (data.usage.prompt_tokens != null || data.usage.completion_tokens != null)
        ? { inputTokens: data.usage.prompt_tokens ?? 0, outputTokens: data.usage.completion_tokens ?? 0 }
        : undefined;

    return {
      text,
      providerName: "openai",
      model: data.model ?? model,
      usage,
    };
  }
}
