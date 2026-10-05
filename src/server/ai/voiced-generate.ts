import { getAIProvider } from "./get-ai-provider";
import { findHardRuleBreaches, findUnverifiedNumbers, toOneDecimal } from "./editorial-guards";
import { activeVoice } from "./voice";
import type { AIGenerationRequest, AIGenerationResult } from "./types";

export class UnverifiedNumbersError extends Error {
  constructor(readonly numbers: string[]) {
    super(`The draft kept citing numbers that are not in the verified data: ${numbers.join(", ")}`);
    this.name = "UnverifiedNumbersError";
  }
}

export class HardRuleError extends Error {
  constructor(readonly phrases: string[]) {
    super(`The draft kept breaking the voice's hard rules: ${phrases.join(", ")}`);
    this.name = "HardRuleError";
  }
}

/**
 * Generates copy and holds it to the voice's hard rules: every number must
 * come from the data the writer was given (the system and user prompts, which
 * carry the verified input and, in the unhinged voice, the league lore), and
 * none of the forbidden phrases may appear.
 *
 * unhinged  a draft that breaks either goes back to the writer with the
 *           offending figures or words named; three strikes and it is
 *           refused — nothing invented or off-limits is ever stored. Scores
 *           that pass are written to one decimal, as the site shows them.
 * classic   one attempt, exactly as before. The live voice is not changed in
 *           behaviour until the new one is approved.
 */
export async function generateVoiced(request: AIGenerationRequest): Promise<AIGenerationResult> {
  const provider = getAIProvider();
  if (activeVoice().mode === "classic") return provider.generate(request);

  const source = `${request.systemPrompt}\n${request.userPrompt}`;
  let userPrompt = request.userPrompt;
  let numbers: string[] = [];
  let phrases: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await provider.generate({ ...request, userPrompt });
    if (result.providerName === "mock") return result;
    numbers = findUnverifiedNumbers(result.text, source);
    phrases = findHardRuleBreaches(result.text, source);
    if (numbers.length === 0 && phrases.length === 0) return { ...result, text: toOneDecimal(result.text) };
    const problems = [
      numbers.length
        ? `It used numbers that are not in the data above: ${numbers.join(", ")}. Use only numbers that appear in the data (or simple gaps and totals of them).`
        : null,
      phrases.length
        ? `It broke a hard rule with: ${phrases.join(", ")}. No sexual language about real people, and never mention where lore came from.`
        : null,
    ].filter(Boolean);
    userPrompt = `${request.userPrompt}\n\nRewrite your previous draft. ${problems.join(" ")}\n\nPrevious draft:\n${result.text}`;
  }
  throw numbers.length ? new UnverifiedNumbersError(numbers) : new HardRuleError(phrases);
}
