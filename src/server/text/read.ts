import { prisma } from "@/lib/db";
import { renderTemplate, specHash, type TextKind, type TextSpec } from "./core";

/**
 * What a page shows for a text.
 *
 *   AI        the stored text was written from exactly these facts; its
 *             {{tokens}} are filled from the current facts.
 *   FALLBACK  no valid AI text — none written yet, generation failed, or the
 *             facts have moved since it was written. The templated sentence is
 *             shown instead, so stale prose never contradicts the page.
 */
export interface RenderedText {
  text: string;
  source: "AI" | "FALLBACK";
  asOfSeason: number;
  asOfWeek: number | null;
  model: string | null;
}

export const textKey = (kind: TextKind, subjectKey: string) => `${kind}:${subjectKey}`;

export async function readTexts(specs: TextSpec[]): Promise<Map<string, RenderedText>> {
  const out = new Map<string, RenderedText>();
  if (specs.length === 0) return out;
  const rows = await prisma.generatedText.findMany({
    where: { OR: [...new Set(specs.map((s) => s.kind))].map((kind) => ({ kind, subjectKey: { in: specs.filter((s) => s.kind === kind).map((s) => s.subjectKey) } })) },
    select: { kind: true, subjectKey: true, template: true, inputHash: true, status: true, asOfSeason: true, asOfWeek: true, model: true },
  });
  const byKey = new Map(rows.map((r) => [textKey(r.kind as TextKind, r.subjectKey), r]));
  for (const spec of specs) {
    const row = byKey.get(textKey(spec.kind, spec.subjectKey));
    const current = row && row.inputHash === specHash(spec) && row.status === "GENERATED";
    const rendered = renderTemplate(current ? row.template : spec.fallback, spec.tokens);
    out.set(textKey(spec.kind, spec.subjectKey), {
      text: rendered.text,
      source: current && rendered.missing.length === 0 ? "AI" : "FALLBACK",
      asOfSeason: spec.asOfSeason,
      asOfWeek: spec.asOfWeek,
      model: current ? row.model : null,
    });
  }
  return out;
}

export async function readText(spec: TextSpec): Promise<RenderedText> {
  return (await readTexts([spec])).get(textKey(spec.kind, spec.subjectKey)) as RenderedText;
}

/**
 * Classifies every spec against what is stored:
 *   stale     missing, or written from facts that have since changed — the
 *             page is showing its fallback and the text is OUT OF DATE;
 *   retry     a templated placeholder written without the model (no attempts);
 *   fallback  current facts, but the model's drafts failed validation, so the
 *             grounded templated sentence stands (not stale; retried when the
 *             facts change or with --force-text);
 *   current   AI text written from exactly these facts.
 */
export async function classifySpecs(specs: TextSpec[]) {
  const out = { stale: [] as TextSpec[], retry: [] as TextSpec[], fallback: [] as TextSpec[], current: [] as TextSpec[] };
  if (specs.length === 0) return out;
  const rows = await prisma.generatedText.findMany({ select: { kind: true, subjectKey: true, inputHash: true, status: true, attempts: true } });
  const byKey = new Map(rows.map((r) => [textKey(r.kind as TextKind, r.subjectKey), r]));
  for (const s of specs) {
    const row = byKey.get(textKey(s.kind, s.subjectKey));
    if (!row || row.inputHash !== specHash(s)) out.stale.push(s);
    else if (row.status === "GENERATED") out.current.push(s);
    else if (row.attempts === 0) out.retry.push(s);
    else out.fallback.push(s);
  }
  return out;
}
