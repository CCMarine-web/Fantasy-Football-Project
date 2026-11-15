import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getAIProvider } from "@/server/ai/get-ai-provider";
import { buildVoicedSystemPrompt } from "@/server/ai/voice";
import { findHardRuleBreaches } from "@/server/ai/editorial-guards";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import type { ContentSafeguards } from "@/server/ai/types";
import { buildUserPrompt, specHash, validateTemplate, type TextSpec } from "./core";

/**
 * Writes one text from its spec:
 *   - skipped when the stored text was written from identical facts;
 *   - otherwise the model drafts, the validator checks every number against
 *     the facts, and a failing draft goes back with its problems named — up
 *     to 2 retries — before the templated fallback is stored instead.
 * Ungrounded numbers are never stored.
 */

export type ProduceOutcome = "skipped" | "generated" | "fallback";

const MAX_ATTEMPTS = 3; // the first draft + 2 retries

function cleanDraft(text: string): string {
  return text
    .replace(/^["“]|["”]$/g, "")
    .replace(/\*\*|__|^#+\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function store(spec: TextSpec, hash: string, data: { template: string; status: "GENERATED" | "FALLBACK"; provider: string; model: string; attempts: number; validation?: unknown }) {
  const row = {
    template: data.template,
    facts: spec.facts as Prisma.InputJsonValue,
    inputHash: hash,
    status: data.status,
    asOfSeason: spec.asOfSeason,
    asOfWeek: spec.asOfWeek,
    provider: data.provider,
    model: data.model,
    attempts: data.attempts,
    validation: (data.validation ?? null) as Prisma.InputJsonValue,
    generatedAt: new Date(),
  };
  await prisma.generatedText.upsert({
    where: { kind_subjectKey: { kind: spec.kind, subjectKey: spec.subjectKey } },
    create: { kind: spec.kind, subjectKey: spec.subjectKey, ...row },
    update: row,
  });
}

export async function produceText(
  spec: TextSpec,
  options: { force?: boolean; noModel?: boolean; safeguards?: ContentSafeguards } = {},
): Promise<ProduceOutcome> {
  const hash = specHash(spec);
  if (!options.force) {
    const existing = await prisma.generatedText.findUnique({
      where: { kind_subjectKey: { kind: spec.kind, subjectKey: spec.subjectKey } },
      select: { inputHash: true, status: true, attempts: true },
    });
    // Same facts: keep it — unless it is a placeholder written without the
    // model, which is retried once the model is available.
    if (existing?.inputHash === hash && (existing.status === "GENERATED" || options.noModel || existing.attempts > 0)) return "skipped";
  }
  if (options.noModel) {
    await store(spec, hash, { template: spec.fallback, status: "FALLBACK", provider: "template", model: "none", attempts: 0 });
    return "fallback";
  }

  const provider = getAIProvider();
  const safeguards = options.safeguards ?? (await getContentSafeguards());
  const systemPrompt = buildVoicedSystemPrompt(
    "You write short pieces for The Rat Trap, a private fantasy football league's website. The league's voice is roast-y, funny and affectionate — trash talk between friends about fantasy decisions, never about anyone's real life. You are given FACTS and must not use any number, record, streak, rank or event that is not in them.",
    spec.contentType,
    safeguards,
  );

  const rejected: { attempt: number; problems: string[] }[] = [];
  let previous: { draft: string; problems: string[] } | undefined;
  let model = "unknown";
  let providerName = "unknown";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await provider.generate({
      promptVersion: `facts-v1:${spec.kind}`,
      systemPrompt,
      userPrompt: buildUserPrompt(spec, previous),
      humorLevel: safeguards.humorLevel,
      maxOutputTokens: 4000,
      reasoningEffort: "low",
    });
    model = result.model;
    providerName = result.providerName;
    if (result.providerName === "mock") break;
    const draft = cleanDraft(result.text);
    const check = validateTemplate(draft, spec.facts, spec.tokens, spec.scopes);
    const breaches = findHardRuleBreaches(draft, JSON.stringify(spec.facts));
    const problems = [...check.problems, ...breaches.map((b) => `breaks a hard rule: "${b}"`)];
    if (draft && problems.length === 0) {
      await store(spec, hash, {
        template: draft,
        status: "GENERATED",
        provider: providerName,
        model,
        attempts: attempt,
        validation: rejected.length ? rejected : undefined,
      });
      return "generated";
    }
    rejected.push({ attempt, problems: problems.length ? problems : ["empty draft"] });
    previous = { draft, problems: problems.length ? problems : ["the draft was empty"] };
  }

  await store(spec, hash, {
    template: spec.fallback,
    status: "FALLBACK",
    provider: providerName,
    model,
    attempts: rejected.length,
    validation: rejected,
  });
  return "fallback";
}

/** Runs specs `concurrency` at a time until done or out of time. */
export async function produceMany(
  specs: TextSpec[],
  options: { budgetMs: number; force?: boolean; noModel?: boolean; concurrency?: number; onProgress?: () => Promise<void> },
): Promise<{ generated: number; fallback: number; skipped: number; failed: number; remaining: number; errors: string[] }> {
  const deadline = Date.now() + options.budgetMs;
  const safeguards = options.noModel ? undefined : await getContentSafeguards();
  const counts = { generated: 0, fallback: 0, skipped: 0, failed: 0, remaining: 0, errors: [] as string[] };
  let next = 0;
  const worker = async () => {
    while (next < specs.length) {
      if (Date.now() > deadline) return;
      const spec = specs[next++];
      try {
        const outcome = await produceText(spec, { force: options.force, noModel: options.noModel, safeguards });
        counts[outcome] += 1;
        if (outcome !== "skipped") await options.onProgress?.();
      } catch (err) {
        counts.failed += 1;
        if (counts.errors.length < 5) counts.errors.push(`${spec.kind} ${spec.subjectKey}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 6, specs.length) }, worker));
  counts.remaining = specs.length - next;
  return counts;
}
