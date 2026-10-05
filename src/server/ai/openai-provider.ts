// Real provider — plain fetch() against the OpenAI Chat Completions API. No
// `openai` npm dependency on purpose (spec: keep the dependency footprint
// down); the request/response shapes we need are small and stable.

import { getEnv } from "@/lib/env";
import type { AIGenerationRequest, AIGenerationResult, AIProvider } from "./types";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * One Chat Completions endpoint. OpenAI and xAI share the API shape, so the
 * same provider serves both; only the base URL, key, default model and a few
 * request parameters differ.
 */
export interface ChatCompletionsTarget {
  name: "openai" | "xai";
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

/** The target selected by AI_PROVIDER. */
export function selectedTarget(): ChatCompletionsTarget {
  const env = getEnv();
  return env.AI_PROVIDER === "xai"
    ? { name: "xai", baseUrl: env.XAI_BASE_URL, apiKey: env.XAI_API_KEY, defaultModel: env.XAI_MODEL }
    : { name: "openai", baseUrl: OPENAI_BASE_URL, apiKey: env.OPENAI_API_KEY, defaultModel: env.OPENAI_MODEL };
}

/** Thrown on any non-2xx response from the OpenAI API, so callers can
 *  distinguish "AI provider failed" from other errors (e.g. to fall back to
 *  the mock provider, surface a retry button, etc). */
export class OpenAIProviderError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Model API request failed with status ${status}: ${body.slice(0, 500)}`);
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
  constructor(private readonly target: ChatCompletionsTarget = selectedTarget()) {}

  async generate(request: AIGenerationRequest): Promise<AIGenerationResult> {
    const { name, baseUrl, apiKey, defaultModel } = this.target;
    const isXai = name === "xai";
    // Per-call overrides name OpenAI models (OPENAI_SYNTHESIS_MODEL and the
    // like); on xAI they mean nothing, so the configured Grok model is used.
    const override = request.model?.trim();
    const model = override && !(isXai && /^(gpt|o\d)/i.test(override)) ? override : defaultModel;

    if (!apiKey.trim()) {
      // Should not happen in practice — getAIProvider() only hands out this
      // provider when isAIConfigured() is true — but fail loudly if it does.
      throw new OpenAIProviderError(0, `${isXai ? "XAI_API_KEY" : "OPENAI_API_KEY"} is not configured`);
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
        /*
         * Token budgets are OpenAI reasoning-model budgets (the gpt-5 family
         * spends them on reasoning first). Grok's reasoning models reject
         * `reasoning_effort` and count reasoning differently, so on xAI the
         * prompt's own length instructions do the limiting.
         */
        ...(!isXai && request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
        ...(!isXai && request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
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
      providerName: name,
      model: data.model ?? model,
      usage,
    };
  }
}
