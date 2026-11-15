import { buildCatalog } from "./catalog";
import { classifySpecs } from "./read";

/**
 * How many AI texts are out of date — for /api/health and verify:texts.
 * stale = missing or written from facts that have since changed (the page is
 * showing the templated fallback for it); fallback = grounded templated text
 * standing in because the model's drafts failed validation.
 */
export async function textStatus() {
  const catalog = await buildCatalog();
  const c = await classifySpecs(catalog);
  const byKind: Record<string, { total: number; stale: number }> = {};
  for (const s of catalog) byKind[s.kind] = { total: (byKind[s.kind]?.total ?? 0) + 1, stale: byKind[s.kind]?.stale ?? 0 };
  for (const s of c.stale) byKind[s.kind].stale += 1;
  return {
    total: catalog.length,
    stale: c.stale.length,
    fallback: c.fallback.length + c.retry.length,
    byKind,
    staleKeys: c.stale.slice(0, 20).map((s) => `${s.kind}:${s.subjectKey}`),
  };
}
