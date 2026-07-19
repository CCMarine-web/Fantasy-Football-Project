import { isAIConfigured } from "@/lib/env";
import { MockAIProvider } from "./mock-provider";
import { OpenAIProvider } from "./openai-provider";
import type { AIProvider } from "./types";

/**
 * Factory for the active AI provider. Every content-service function should
 * obtain its provider through this rather than importing MockAIProvider or
 * OpenAIProvider directly, so the whole site automatically runs on mock
 * content until OPENAI_API_KEY is set — no per-callsite branching needed.
 */
export function getAIProvider(): AIProvider {
  return isAIConfigured() ? new OpenAIProvider() : new MockAIProvider();
}
