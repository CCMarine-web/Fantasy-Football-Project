import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getEnv, isAIConfigured } from "@/lib/env";
import { getAIProvider } from "@/server/ai/get-ai-provider";
import { buildSystemPrompt } from "@/server/ai/prompt-helpers";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { buildLeagueVoiceGuidance } from "@/server/ai/research-packet";
import { getRecentlyUsedMaterial, avoidRepetitionInstruction, recordContentUsage } from "@/server/ai/content-memory";
import { hashInputs, putBlurb } from "@/server/ai/blurb-cache";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { getTradeTribunal } from "@/server/repositories/trade-tribunal-repository";
import type { AIUsage } from "@/server/ai/types";

/**
 * Writes the short AI commentary the site displays, ONCE, into AIBlurbCache /
 * Rivalry.summary. Pages only ever read those — nothing calls a model during a
 * render any more.
 *
 *   npx tsx scripts/ai/backfill-blurbs.ts --dry-run
 *   npx tsx scripts/ai/backfill-blurbs.ts --purge-mock
 *   npx tsx scripts/ai/backfill-blurbs.ts --kind power,rivalry,trade
 *   npx tsx scripts/ai/backfill-blurbs.ts --limit 5
 *
 * Every prompt is fed ONLY verified numbers plus approved league context (the
 * league voice profile and each manager's private communication profile). Raw
 * chat messages are never included. Already-used material is listed back to the
 * writer so jokes and angles don't repeat across the site.
 */

const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5": { in: 1.25, out: 10.0 },
};

class Meter {
  calls = 0;
  private byModel = new Map<string, { in: number; out: number; calls: number }>();
  record(model: string, usage?: AIUsage) {
    this.calls++;
    const m = this.byModel.get(model) ?? { in: 0, out: 0, calls: 0 };
    m.calls++;
    if (usage) {
      m.in += usage.inputTokens;
      m.out += usage.outputTokens;
    }
    this.byModel.set(model, m);
  }
  report(): string {
    let total = 0;
    const lines: string[] = [];
    for (const [model, m] of this.byModel) {
      const key = Object.keys(PRICES).find((k) => model.startsWith(k));
      const p = key ? PRICES[key] : { in: 0, out: 0 };
      const usd = (m.in / 1e6) * p.in + (m.out / 1e6) * p.out;
      total += usd;
      lines.push(`  ${model}: ${m.calls} calls, ${m.in.toLocaleString()} in / ${m.out.toLocaleString()} out => $${usd.toFixed(4)}`);
    }
    lines.push(`  TOTAL: ${this.calls} calls => ~$${total.toFixed(2)}`);
    return lines.join("\n");
  }
}

interface Ctx {
  systemBase: string;
  voice: string;
  avoid: string;
  model: string;
  meter: Meter;
  dryRun: boolean;
}

async function write(ctx: Ctx, userPrompt: string, maxTokens: number): Promise<{ text: string; provider: string; model: string } | null> {
  if (ctx.dryRun) return null;
  const result = await getAIProvider().generate({
    promptVersion: "site-blurb-v1",
    systemPrompt: ctx.systemBase,
    userPrompt: [ctx.voice, ctx.avoid, userPrompt].filter(Boolean).join("\n\n"),
    humorLevel: 3,
    maxOutputTokens: maxTokens,
    reasoningEffort: "low",
    model: ctx.model,
  });
  if (result.providerName === "mock") return null;
  ctx.meter.record(result.model, result.usage);
  return { text: result.text.trim(), provider: result.providerName, model: result.model };
}

const SYSTEM = `You are a staff writer for "The Rat Trap", a fantasy-football league newspaper. Write with personality — dry, needling, confident — but NEVER invent a statistic, event, quote, or storyline. You may only characterise the numbers you are given. If the numbers are thin, be brief rather than padding with invention. Do not mention that you are an AI, do not mention prompts or data sources, and do not quote anyone. Output plain prose only: no markdown, no headings, no quotation marks around the whole response.`;

// --- purge ------------------------------------------------------------------

async function purgeMock() {
  // Mock rows were cached permanently by the old generate-once-reuse paths, so
  // placeholder copy kept being served even after a real key was configured.
  const gen = await prisma.aIContentGeneration.deleteMany({ where: { providerName: "mock" } });
  console.log(`[purge] deleted ${gen.count} mock AIContentGeneration row(s)`);

  const grades = await prisma.draftGrade.updateMany({
    where: { providerName: "mock" },
    data: { rationale: null, revisitedRationale: null, providerName: null },
  });
  console.log(`[purge] cleared rationale on ${grades.count} mock DraftGrade row(s)`);

  const rivalries = await prisma.rivalry.updateMany({
    where: { summaryIsMock: true },
    data: { summary: null, summaryIsMock: false },
  });
  console.log(`[purge] cleared ${rivalries.count} mock rivalry summary/summaries`);
}

// --- power rankings ---------------------------------------------------------

async function backfillPowerRankings(ctx: Ctx, limit: number | null) {
  const data = await getPowerRankings();
  if (!data || data.rows.length === 0) {
    console.log("[power] no season to rank — nothing to write");
    return;
  }
  const rows = limit ? data.rows.slice(0, limit) : data.rows;
  console.log(`[power] ${data.seasonYear} (${data.mode}, through week ${data.throughWeek}): ${rows.length} team(s)`);

  for (const r of rows) {
    // Only figures the rating actually used, so the copy cannot cite a stat the
    // page doesn't show. Record is passed as context and explicitly labelled as
    // not being an input.
    const facts = {
      season: data.seasonYear,
      basis: data.mode === "PRESEASON" ? "preseason projection, no games played" : `through week ${data.throughWeek}`,
      rank: r.rank,
      of: data.rows.length,
      previousRank: r.previousRank,
      team: r.teamName,
      manager: r.managerName,
      powerScore: r.score,
      pointsPerGame: r.weightedPointsPerGame,
      allPlay: `${r.allPlayWins}-${r.allPlayLosses}`,
      expectedWins: r.expectedWins,
      actualRecordForContextOnly: r.record,
      lineupEfficiencyPct: r.lineupEfficiency,
      strongest: [...r.factors].sort((a, b) => b.value - a.value)[0]?.label,
      weakest: [...r.factors].sort((a, b) => a.value - b.value)[0]?.label,
    };
    const inputHash = hashInputs({
      rank: r.rank,
      score: r.score,
      ppg: r.weightedPointsPerGame,
      allPlay: r.allPlayPct,
      exp: r.expectedWins,
      week: data.throughWeek,
      mode: data.mode,
    });
    const subjectKey = `${data.seasonYear}:${r.fantasyTeamId}`;

    const prompt = `Write ONE sentence (max 32 words) about this team's current standing in the ${data.seasonYear} power rankings.\n\nThese rankings measure team QUALITY, not results: win-loss record is NOT an input. Do not claim the ranking is based on wins, championships or playoff finish, and do not restate the record as if it drove the rating.\n\nVerified facts:\n${JSON.stringify(facts, null, 2)}`;
    const out = await write(ctx, prompt, 900);
    if (!out) {
      console.log(`  [dry/mock] ${r.managerName}`);
      continue;
    }
    const stored = await putBlurb({ kind: "POWER_RANKING", subjectKey, inputHash, text: out.text, providerName: out.provider, model: out.model });
    console.log(`  ${r.rank}. ${r.managerName}: ${stored ? out.text.slice(0, 90) : "(not stored)"}`);
  }
}

// --- rivalries --------------------------------------------------------------

async function backfillRivalries(ctx: Ctx, limit: number | null) {
  // No default cap. A cap here is worse than it looks: a pairing that already
  // has a summary but falls outside the cap keeps commentary written from
  // superseded numbers, so after the ESPN import most rivalry pages would have
  // described the wrong series record. Each pairing is still skipped when its
  // input hash is unchanged, so a rerun costs nothing unless the numbers moved.
  const rivalries = await prisma.rivalry.findMany({
    where: { gamesPlayed: { gt: 0 } },
    orderBy: [{ isOfficial: "desc" }, { rivalryScore: "desc" }],
    ...(limit ? { take: limit } : {}),
    select: {
      id: true, isOfficial: true, gamesPlayed: true, managerAWins: true, managerBWins: true, ties: true,
      managerAPoints: true, managerBPoints: true, averageMargin: true, playoffMeetings: true,
      championshipMeetings: true, closestGameMargin: true, largestBlowoutMargin: true,
      currentStreakManagerId: true, currentStreakCount: true, longestStreakCount: true,
      lastMeetingSeason: true, summaryInputHash: true,
      managerA: { select: { id: true, displayName: true, commProfile: { select: { styleSummary: true } } } },
      managerB: { select: { id: true, displayName: true, commProfile: { select: { styleSummary: true } } } },
    },
  });
  console.log(`[rivalry] ${rivalries.length} pairing(s)`);

  for (const r of rivalries) {
    const facts = {
      official: r.isOfficial,
      managerA: r.managerA.displayName,
      managerB: r.managerB.displayName,
      seriesRecord: `${r.managerAWins}-${r.managerBWins}${r.ties ? `-${r.ties}` : ""}`,
      meetings: r.gamesPlayed,
      totalPoints: `${Math.round(r.managerAPoints)} vs ${Math.round(r.managerBPoints)}`,
      averageMargin: r.averageMargin,
      closestMargin: r.closestGameMargin,
      biggestMargin: r.largestBlowoutMargin,
      playoffMeetings: r.playoffMeetings,
      titleGameMeetings: r.championshipMeetings,
      currentStreak: r.currentStreakManagerId === r.managerA.id
        ? `${r.managerA.displayName} x${r.currentStreakCount}`
        : r.currentStreakManagerId === r.managerB.id
          ? `${r.managerB.displayName} x${r.currentStreakCount}`
          : "none",
      lastMeetingSeason: r.lastMeetingSeason,
    };
    const styles = [
      r.managerA.commProfile?.styleSummary ? `${r.managerA.displayName}: ${r.managerA.commProfile.styleSummary}` : null,
      r.managerB.commProfile?.styleSummary ? `${r.managerB.displayName}: ${r.managerB.commProfile.styleSummary}` : null,
    ].filter(Boolean).join("\n");

    const inputHash = hashInputs(facts);
    if (r.summaryInputHash === inputHash) {
      console.log(`  skip (unchanged): ${r.managerA.displayName} vs ${r.managerB.displayName}`);
      continue;
    }

    const prompt = `Write 2-3 sentences about this head-to-head rivalry for the league's Rivalries page.\n\nVerified head-to-head facts:\n${JSON.stringify(facts, null, 2)}${styles ? `\n\nHow each manager comes across in league chat (tone guidance only — do not quote or reference chat):\n${styles}` : ""}`;
    const out = await write(ctx, prompt, 1200);
    if (!out) {
      console.log(`  [dry/mock] ${r.managerA.displayName} vs ${r.managerB.displayName}`);
      continue;
    }
    await prisma.rivalry.update({
      where: { id: r.id },
      data: {
        summary: out.text,
        summaryProvider: out.provider,
        summaryModel: out.model,
        summaryIsMock: false,
        summaryInputHash: inputHash,
      },
    });
    console.log(`  ${r.managerA.displayName} vs ${r.managerB.displayName}: ${out.text.slice(0, 90)}`);
  }
}

// --- trades -----------------------------------------------------------------

async function backfillTrades(ctx: Ctx, limit: number | null) {
  const trades = await getTradeTribunal();
  const list = limit ? trades.slice(0, limit) : trades;
  console.log(`[trade] ${list.length} trade(s)`);

  for (const t of list) {
    const facts = {
      season: t.seasonYear,
      week: t.week,
      sides: t.sides.map((s) => ({ manager: s.managerName, acquired: s.acquired, restOfSeasonPoints: s.hindsightPoints })),
      differential: t.differential,
      hindsight: t.hindsightSummary,
      hindsightAvailable: t.hindsightAvailable,
    };
    const inputHash = hashInputs(facts);
    const prompt = `Write ONE sentence (max 34 words) delivering a verdict on this trade for the league's Trade Tribunal. If hindsightAvailable is false, say the evidence is thin rather than guessing a winner.\n\nVerified facts:\n${JSON.stringify(facts, null, 2)}`;
    const out = await write(ctx, prompt, 900);
    if (!out) {
      console.log(`  [dry/mock] ${t.seasonYear} wk ${t.week}`);
      continue;
    }
    const stored = await putBlurb({ kind: "TRADE_VERDICT", subjectKey: t.transactionId, inputHash, text: out.text, providerName: out.provider, model: out.model });
    console.log(`  ${t.seasonYear} wk ${t.week}: ${stored ? out.text.slice(0, 90) : "(not stored)"}`);
  }
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  const limit = get("--limit") ? Number(get("--limit")) : null;
  const kinds = (get("--kind") ?? "power,rivalry,trade").split(",").map((k) => k.trim());

  console.log("=== AI blurb backfill ===");
  console.log(`kinds: ${kinds.join(", ")} | dryRun: ${dryRun} | limit: ${limit ?? "none"}`);

  if (args.includes("--purge-mock")) {
    if (dryRun) console.log("[purge] skipped (--dry-run)");
    else await purgeMock();
  }

  if (!isAIConfigured() && !dryRun) {
    console.log("No OPENAI_API_KEY — nothing can be generated. Pages will show honest empty states.");
    return;
  }

  const safeguards = await getContentSafeguards();
  const [voice, used] = await Promise.all([
    buildLeagueVoiceGuidance(),
    getRecentlyUsedMaterial({ limit: 60 }),
  ]);

  const ctx: Ctx = {
    systemBase: buildSystemPrompt(SYSTEM, safeguards),
    voice,
    avoid: avoidRepetitionInstruction(used),
    model: getEnv().OPENAI_MODEL,
    meter: new Meter(),
    dryRun,
  };
  console.log(`league voice guidance: ${voice ? `${voice.length} chars` : "none"}`);

  if (kinds.includes("power")) await backfillPowerRankings(ctx, limit);
  if (kinds.includes("rivalry")) await backfillRivalries(ctx, limit);
  if (kinds.includes("trade")) await backfillTrades(ctx, limit);

  if (!dryRun && ctx.meter.calls > 0) {
    // Record that this run leaned on league knowledge, so later generations
    // vary their angles.
    await recordContentUsage({ factKeys: [`blurb-backfill:${kinds.join("+")}`], articleType: "SITE_BLURB" });
  }

  console.log("\n=== Token usage / estimated cost ===");
  console.log(ctx.meter.report());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
