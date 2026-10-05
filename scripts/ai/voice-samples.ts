import "../lib/load-env";
import { writeFileSync } from "node:fs";

/**
 * Writes a review batch of AI copy in a chosen voice, from real league data,
 * WITHOUT storing any of it — so nothing in an unapproved voice can reach a
 * page. The output is markdown for VOICE-GUIDE.md.
 *
 *   npx tsx scripts/ai/voice-samples.ts                       # unhinged, spice 3, AI_PROVIDER as configured
 *   npx tsx scripts/ai/voice-samples.ts --spice 2 --provider xai --out samples-grok.md
 *
 * Every piece goes through the same generator the site uses, so the voice,
 * the safeguards and the verified-numbers check all apply. A piece the check
 * refused is reported as refused rather than shown.
 */
function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Before anything reads them. Nothing in this process is persisted.
process.env.AI_VOICE = arg("voice", "unhinged");
process.env.SPICE_LEVEL = arg("spice", "3");
process.env.AI_NO_PERSIST = "1";
if (process.argv.includes("--provider")) process.env.AI_PROVIDER = arg("provider", "openai");

async function main() {
  const { prisma } = await import("@/lib/db");
  const { getEnv, isAIConfigured } = await import("@/lib/env");
  const { activeVoice } = await import("@/server/ai/voice");
  const { generateWeeklyContent } = await import("@/server/ai/weekly-pipeline");
  const { buildBlurbContext, powerBlurbPrompt, tradeVerdictPrompt, writeBlurb } = await import("@/server/ai/site-blurbs");
  const { computePowerRankings } = await import("@/server/repositories/power-rankings-repository");
  const { computeTradeTribunal, isHeadlineTrade } = await import("@/server/repositories/trade-tribunal-repository");
  const { getOfficialRivalries } = await import("@/server/repositories/computed-rivalries-repository");
  const { generateRivalryBlurb } = await import("@/server/ai/services/rivalry-blurb");
  const { generateDraftGradesForSeason } = await import("@/server/repositories/draft-grade-repository");
  const { buildScoutingReportInput } = await import("@/server/repositories/manager-repository");
  const { generateScoutingReport } = await import("@/server/ai/services/scouting-report");
  const { buildSeasonSummaryInput } = await import("@/server/repositories/season-narrative-repository");
  const { generateSeasonSummary } = await import("@/server/ai/services/season-summary");
  const { getWeeklyAwards } = await import("@/server/repositories/weekly-awards-repository");
  const { getContentSafeguards } = await import("@/server/repositories/ai-config-repository");

  if (!isAIConfigured()) throw new Error("No API key for the selected provider.");
  const env = getEnv();
  const voice = activeVoice();
  const model = env.AI_PROVIDER === "xai" ? env.XAI_MODEL : env.OPENAI_MODEL;
  const out: string[] = [];
  const section = (title: string) => out.push(`\n### ${title}\n`);
  const sample = (label: string, text: string) => out.push(`**${label}**\n\n> ${text.trim().replace(/\n+/g, "\n>\n> ")}\n`);
  const refused = (label: string, e: unknown) =>
    out.push(`**${label}** — *refused: ${e instanceof Error ? e.message : String(e)}*\n`);
  const attempt = async (label: string, fn: () => Promise<string | null | undefined>) => {
    try {
      const text = await fn();
      if (text) sample(label, text);
      else out.push(`**${label}** — *no output*\n`);
    } catch (e) {
      refused(label, e);
    }
    console.log(`  done: ${label}`);
  };

  out.push(`*Generated ${new Date().toISOString().slice(0, 10)} · voice: ${voice.mode} · spice ${voice.spice} · provider: ${env.AI_PROVIDER} (${model}) · nothing below was stored or published.*`);

  const season = await prisma.season.findFirstOrThrow({ where: { isCurrent: true } });
  const safeguards = await getContentSafeguards();
  const ctx = await buildBlurbContext();

  section("Matchup recaps (2026, week 3)");
  const recaps: [string, string][] = [];
  const previews: [string, string][] = [];
  await generateWeeklyContent({
    seasonId: season.id,
    recapWeek: 3,
    previewWeek: 4,
    regenerate: { maxPerKind: 3 },
    onWritten: (kind, label, text) => (kind === "recap" ? recaps : previews).push([label, text]),
  }).catch((e) => refused("pipeline", e));
  for (const [label, text] of recaps) sample(label, text);
  section("Matchup previews (2026, week 4)");
  for (const [label, text] of previews) sample(label, text);

  section("Power-ranking blurbs (2026, through week 3)");
  const power = await computePowerRankings();
  if (power) {
    for (const r of [power.rows[0], power.rows[Math.floor(power.rows.length / 2)], power.rows.at(-1)!]) {
      await attempt(`#${r.rank} ${r.managerName}`, async () => (await writeBlurb(ctx, powerBlurbPrompt(power, r), 2200, "power-ranking"))?.text);
    }
  }

  section("Rivalry one-liners (official rivalries)");
  for (const r of (await getOfficialRivalries()).slice(0, 3)) {
    const leader =
      r.managerAWins === r.managerBWins ? `tied ${r.managerAWins}-${r.managerBWins}` : r.managerAWins > r.managerBWins ? `${r.managerAName} leads ${r.managerAWins}-${r.managerBWins}` : `${r.managerBName} leads ${r.managerBWins}-${r.managerAWins}`;
    const streakName = r.currentStreakManagerId === r.managerAId ? r.managerAName : r.currentStreakManagerId === r.managerBId ? r.managerBName : null;
    await attempt(`${r.managerAName} vs ${r.managerBName}`, () =>
      generateRivalryBlurb(
        {
          managerA: r.managerAName,
          managerB: r.managerBName,
          record: leader,
          gamesPlayed: r.gamesPlayed,
          playoffMeetings: r.playoffMeetings,
          closestMargin: r.closestGameMargin ?? 0,
          biggestMargin: r.largestBlowoutMargin ?? 0,
          currentStreak: streakName ? `${streakName} has won ${r.currentStreakCount} straight` : "no current streak",
        },
        safeguards,
      ),
    );
  }

  section("Trade verdicts (the three most lopsided trades)");
  for (const t of (await computeTradeTribunal()).filter(isHeadlineTrade).slice(0, 3)) {
    await attempt(`${t.seasonYear} Week ${t.week}: ${t.sides.map((s) => s.managerName).join(" ↔ ")}`, async () => (await writeBlurb(ctx, tradeVerdictPrompt(t), 2200, "trade-verdict"))?.text);
  }

  section("Draft grades (2026 draft day — best and worst)");
  const grades = await generateDraftGradesForSeason(season.id, { preview: true });
  const sorted = [...(grades.previews ?? [])].sort((a, b) => b.score - a.score);
  for (const g of [sorted[0], sorted.at(-1)].filter(Boolean)) sample(`${g!.managerName} — ${g!.grade}`, g!.rationale);

  section("Scouting reports");
  const managers = await prisma.manager.findMany({ where: { isActive: true }, orderBy: { displayName: "asc" }, take: 2 });
  for (const m of managers) {
    await attempt(m.displayName, async () => {
      const input = await buildScoutingReportInput(m.id, m.displayName);
      return input ? (await generateScoutingReport(input, safeguards)).text : null;
    });
  }

  section("Weekly awards (2026, week 3)");
  const awards = await getWeeklyAwards(season.id, 3);
  await attempt("Week 3 awards", async () => {
    const facts = awards.map((a) => ({ award: a.label, winner: a.managerName, value: a.value, fact: a.description }));
    const prompt = `Write the week's award citations: one punchy line per award below, naming the winner and the number that earned it.\n\nVerified facts:\n${JSON.stringify(facts, null, 2)}`;
    return (await writeBlurb(ctx, prompt, 2400, "weekly-awards"))?.text;
  });

  section("Season summary (2025)");
  const s2025 = await prisma.season.findFirstOrThrow({ where: { year: 2025 } });
  await attempt("2025 season in review", async () => {
    const input = await buildSeasonSummaryInput(s2025.id, 2025);
    return input ? (await generateSeasonSummary(input, safeguards)).text : null;
  });

  section("Receipts");
  out.push(
    "*No receipt has been approved yet (the review queue is at /admin/receipts), and receipts are only ever written from approved ones — so there is nothing to sample. Once one is approved, the receipt verdict uses this voice like everything else.*\n",
  );

  const path = arg("out", "voice-samples.md");
  writeFileSync(path, out.join("\n"));
  console.log(`\nWrote ${path}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
