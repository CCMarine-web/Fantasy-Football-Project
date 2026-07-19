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
    message?: {
      content?: string | null;
    };
  }>;
}

export class OpenAIProvider implements AIProvider {
  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const env = getEnv();
    const apiKey = env.OPENAI_API_KEY;
    const model = env.OPENAI_MODEL;

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
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new OpenAIProviderError(response.status, body);
    }

    const data = (await response.json()) as ChatCompletionsResponse;
    const text = data.choices?.[0]?.message?.content ?? "";

    return {
      text,
      providerName: "openai",
      model: data.model ?? model,
    };
  }
}
