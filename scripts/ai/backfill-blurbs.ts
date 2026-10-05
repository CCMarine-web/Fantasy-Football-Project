import "../lib/load-env";
import { prisma } from "@/lib/db";
import { isAIConfigured } from "@/lib/env";
import { recordContentUsage } from "@/server/ai/content-memory";
import { hashInputs, putBlurb } from "@/server/ai/blurb-cache";
import { findEditorialProblems } from "@/server/ai/editorial-guards";
import { getPowerRankings, powerBlurbHash } from "@/server/repositories/power-rankings-repository";
import { getTradeTribunal, tradeVerdictKey } from "@/server/repositories/trade-tribunal-repository";
import { buildBlurbContext, powerBlurbPrompt, tradeVerdictPrompt, writeBlurb, type BlurbContext } from "@/server/ai/site-blurbs";
import { activeVoice, type VoiceContentType } from "@/server/ai/voice";
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
  blurb: BlurbContext;
  meter: Meter;
  dryRun: boolean;
}

/**
 * Generates one piece of copy through the shared writer (server/ai/site-blurbs),
 * which applies the active voice, the editorial guards and — in the unhinged
 * voice — the verified-numbers check. Returns null in a dry run, for mock
 * output, or when the writer refuses a draft after three attempts.
 */
async function write(
  ctx: Ctx,
  userPrompt: string,
  maxTokens: number,
  contentType: VoiceContentType,
): Promise<{ text: string; provider: string; model: string } | null> {
  if (ctx.dryRun) return null;
  const out = await writeBlurb(ctx.blurb, userPrompt, maxTokens, contentType).catch((e: Error) => {
    console.log(`      refused: ${e.message}`);
    return null;
  });
  if (out) ctx.meter.record(out.model, out.usage);
  return out;
}

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
    // Prompt and cache key are shared with the weekly refresh (server/ai/site-blurbs).
    const inputHash = powerBlurbHash(r, data.throughWeek, data.mode);
    const subjectKey = `${data.seasonYear}:${r.fantasyTeamId}`;
    const prompt = powerBlurbPrompt(data, r);
    const out = await write(ctx, prompt, 2200, "power-ranking");
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
      lastMeetingSeason: true, summaryInputHash: true, summary: true,
      managerA: { select: { id: true, displayName: true, commProfile: { select: { styleSummary: true, isMock: true } } } },
      managerB: { select: { id: true, displayName: true, commProfile: { select: { styleSummary: true, isMock: true } } } },
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
      // Championship bracket only. Consolation meetings are not supplied at
      // all: four summaries described toilet-bowl games as playoff history
      // when the two were merely labelled differently, so the writer now has
      // no consolation data to reach for.
      playoffMeetings: r.playoffMeetings,
      titleGameMeetings: r.championshipMeetings,
      // Structured rather than pre-formatted. A previous version supplied the
      // string "Michael Shea x7", and sixteen of the forty-five summaries
      // simply pasted that token into the prose. Giving the writer a name and a
      // number leaves it no shorthand to copy.
      currentStreakHolder:
        r.currentStreakManagerId === r.managerA.id
          ? r.managerA.displayName
          : r.currentStreakManagerId === r.managerB.id
            ? r.managerB.displayName
            : null,
      currentStreakConsecutiveWins: r.currentStreakCount || null,
      lastMeetingSeason: r.lastMeetingSeason,
    };
    const styles = [
      r.managerA.commProfile?.styleSummary && !r.managerA.commProfile.isMock
        ? `${r.managerA.displayName}: ${r.managerA.commProfile.styleSummary}`
        : null,
      r.managerB.commProfile?.styleSummary && !r.managerB.commProfile.isMock
        ? `${r.managerB.displayName}: ${r.managerB.commProfile.styleSummary}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    // The already-consolidated relationship summary for this exact pair, if one
    // was distilled. Pairs are stored canonically (managerAId < managerBId), so
    // both orderings are checked. This is tone/context research only — never
    // quoted, and the raw archive is not touched.
    const relationship = await prisma.managerRelationship.findFirst({
      where: {
        OR: [
          { managerAId: r.managerA.id, managerBId: r.managerB.id },
          { managerAId: r.managerB.id, managerBId: r.managerA.id },
        ],
        isMock: false,
      },
      select: { summary: true, relationshipType: true },
    });

    // Regenerating whenever the relationship context changes too, not just the
    // numbers — otherwise a richer packet would be silently skipped.
    const contextFingerprint = hashInputs({ styles, relationship: relationship?.summary ?? null });

    const inputHash = hashInputs({ facts, context: contextFingerprint });
    /*
     * The unchanged-input skip exists to avoid paying for copy nobody asked to
     * change — not to preserve a defect. Two official cards were serving "expect
     * more quick-fire meme drops" and "the closet game was a 1.84-point
     * nail-biter" precisely because the numbers behind them had not moved since.
     * A saved summary with a visible fault is always rewritten.
     */
    const savedProblems = r.summary ? findEditorialProblems(r.summary) : [];
    if (r.summaryInputHash === inputHash && savedProblems.length === 0) {
      console.log(`  skip (unchanged): ${r.managerA.displayName} vs ${r.managerB.displayName}`);
      continue;
    }
    if (savedProblems.length > 0) {
      console.log(
        `  rewriting ${r.managerA.displayName} vs ${r.managerB.displayName} — saved copy has: ${savedProblems.map((p) => p.label).join("; ")}`,
      );
    }

    const prompt = [
      `Write 2-3 sentences about this head-to-head rivalry for the league's Rivalries page.`,
      ``,
      `Write like someone who has watched every one of these games, not like a stats API.`,
      ``,
      `Pick the two or three numbers that actually tell the story and build sentences around them. Do NOT walk the list reciting every field — a sentence like "an average margin of 23.16 with a closest margin of 1.28 and a biggest margin of 54.38" is a data dump, not writing.`,
      ``,
      `Never echo the raw formatting of the data: no "Michael Shea x7", no "0 title game meetings", no field names. Say "seven straight" and simply leave out anything that is zero — an absence is only worth a clause if it is genuinely the point.`,
      ``,
      `Every figure you do cite is printed on the same card, so it must match exactly. Do not round a record, do not flip who leads, and do not claim a playoff or title meeting that is not in the facts.`,
      ``,
      `"playoffMeetings" counts championship-bracket games only. If it is 0, this pair has NEVER met in the playoffs — do not write "they have met in the postseason" and leave a reader to assume it mattered. Never mention a toilet bowl, a consolation bracket or a placement game: those results are not in your facts, so anything you say about one is invented.`,
      ``,
      `Verified head-to-head facts:`,
      JSON.stringify(facts, null, 2),
      styles
        ? `\nHow each manager comes across (tone guidance only — never quote it, never mention a chat):\n${styles}`
        : ``,
      relationship
        ? `\nWhat this pairing is actually like (${relationship.relationshipType.toLowerCase()}; tone and angle only — never quote it, never mention a chat):\n${relationship.summary}`
        : ``,
    ]
      .filter(Boolean)
      .join("\n");
    const out = await write(ctx, prompt, 2600, "rivalry");
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
    // Prompt and key are shared with the weekly refresh (server/ai/site-blurbs).
    const inputHash = tradeVerdictKey(t);
    const prompt = tradeVerdictPrompt(t);
    const out = await write(ctx, prompt, 2200, "trade-verdict");
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

  const blurb = await buildBlurbContext();
  const ctx: Ctx = { blurb, meter: new Meter(), dryRun };
  console.log(`league voice guidance: ${blurb.voice ? `${blurb.voice.length} chars` : "none"} | voice: ${activeVoice().mode}`);

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
