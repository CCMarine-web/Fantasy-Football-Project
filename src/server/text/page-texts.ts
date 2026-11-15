import { prisma } from "@/lib/db";
import { getLeagueClock } from "@/server/league-clock";
import type { PowerRankingsView } from "@/server/repositories/power-rankings-repository";
import type { RivalryView } from "@/server/repositories/computed-rivalries-repository";
import type { TradeTribunalView } from "@/server/repositories/trade-tribunal-repository";
import { headToHeadLines, listManagerRows } from "@/server/repositories/manager-repository";
import { getCareerLuck } from "@/server/repositories/luck-repository";
import { getVerifiedRowsCached } from "@/server/repositories/head-to-head-repository";
import { getWeeklyAwards } from "@/server/repositories/weekly-awards-repository";
import { buildCatalog, newsIssueFacts } from "./catalog";
import { readTexts, textKey, type RenderedText } from "./read";
import { loadMatchupInfo, previewSpec, recapSpec } from "./specs/matchup";
import {
  awardsSpec,
  loadScoutingFacts,
  managerBioSpec,
  newsIssueSpec,
  powerBlurbSpecs,
  rivalrySpec,
  scoutingSpec,
  tradeVerdictSpec,
} from "./specs/league";

/**
 * The page side of facts-first text: each helper builds the spec from the
 * page's own data and returns what to show — the AI text when it was written
 * from these exact facts, the templated fallback otherwise.
 */

async function asOf() {
  const clock = await getLeagueClock();
  return { season: clock?.seasonYear ?? new Date().getFullYear(), week: clock?.lastStoredWeek ?? null };
}

export async function powerBlurbTexts(view: PowerRankingsView | null): Promise<Map<string, RenderedText>> {
  if (!view) return new Map();
  const specs = powerBlurbSpecs(view);
  const texts = await readTexts(specs);
  return new Map(specs.map((s) => [s.subjectKey.split(":")[1], texts.get(textKey(s.kind, s.subjectKey))!]));
}

export async function rivalryTexts(views: RivalryView[]): Promise<Map<string, RenderedText>> {
  const when = await asOf();
  const specs = views.map((r) => rivalrySpec(r, when));
  const texts = await readTexts(specs);
  return new Map(specs.map((s) => [s.subjectKey, texts.get(textKey(s.kind, s.subjectKey))!]));
}

export async function managerBioTexts(): Promise<Map<string, RenderedText>> {
  const [when, rows, luck, verified] = await Promise.all([asOf(), listManagerRows(), getCareerLuck(), getVerifiedRowsCached()]);
  const specs = rows.map((row) => managerBioSpec(row, luck.get(row.managerId) ?? null, headToHeadLines(verified, row.managerId), when));
  const texts = await readTexts(specs);
  return new Map(specs.map((s) => [s.subjectKey, texts.get(textKey(s.kind, s.subjectKey))!]));
}

export async function scoutingText(managerId: string, managerName: string): Promise<RenderedText | null> {
  const when = await asOf();
  const f = await loadScoutingFacts(managerId, managerName, when.season, when.week);
  if (!f) return null;
  const spec = scoutingSpec(f, when);
  return (await readTexts([spec])).get(textKey(spec.kind, spec.subjectKey)) ?? null;
}

export async function matchupTexts(matchupId: string): Promise<{ preview: RenderedText | null; recap: RenderedText | null }> {
  const info = await loadMatchupInfo(matchupId);
  if (!info) return { preview: null, recap: null };
  const [preview, recap] = await Promise.all([previewSpec(info), recapSpec(info)]);
  const specs = [preview, ...(recap ? [recap] : [])];
  const texts = await readTexts(specs);
  return {
    preview: texts.get(textKey(preview.kind, preview.subjectKey)) ?? null,
    recap: recap ? (texts.get(textKey(recap.kind, recap.subjectKey)) ?? null) : null,
  };
}

export async function tradeVerdictTexts(trades: TradeTribunalView[]): Promise<Map<string, RenderedText>> {
  const specs = trades.map(tradeVerdictSpec);
  const texts = await readTexts(specs);
  return new Map(specs.map((s) => [s.subjectKey, texts.get(textKey(s.kind, s.subjectKey))!]));
}

export async function awardsText(seasonId: string, seasonYear: number, week: number): Promise<RenderedText | null> {
  const spec = awardsSpec(seasonYear, week, await getWeeklyAwards(seasonId, week));
  if (!spec) return null;
  return (await readTexts([spec])).get(textKey(spec.kind, spec.subjectKey)) ?? null;
}

export async function newsIssueText(seasonYear: number, week: number): Promise<RenderedText | null> {
  const season = await prisma.season.findFirst({ where: { year: seasonYear }, select: { id: true } });
  if (!season) return null;
  const hasResults = await prisma.matchup.count({ where: { seasonId: season.id, week, status: "FINAL" } });
  if (!hasResults) return null;
  const spec = newsIssueSpec(await newsIssueFacts(season.id, seasonYear, week));
  return (await readTexts([spec])).get(textKey(spec.kind, spec.subjectKey)) ?? null;
}

export async function draftRevisitTexts(): Promise<Map<string, RenderedText>> {
  const specs = await buildCatalog({ kinds: ["DRAFT_REVISIT"] });
  const texts = await readTexts(specs);
  return new Map(specs.map((s) => [s.subjectKey.split(":")[1], texts.get(textKey(s.kind, s.subjectKey))!]));
}
