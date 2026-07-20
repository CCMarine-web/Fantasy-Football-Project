// Weekly in-season content pipeline: sync fresh Sleeper data, then generate
// recaps of the just-completed week and previews of the upcoming week, storing
// each as an AIContentGeneration linked (via inputSummary.matchupId) to its
// Matchup so the matchup page can display it. Idempotent — a matchup that
// already has a preview/recap is skipped, so re-running (or the cron firing
// twice) never double-generates. Degrades to mock content without an
// OPENAI_API_KEY, and no-ops cleanly when there's nothing to generate.

import { prisma } from "@/lib/db";
import { syncCurrentLeague } from "@/server/sleeper";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generateMatchupRecap } from "@/server/ai/services/matchup-recap";
import { generateMatchupPreview } from "@/server/ai/services/matchup-preview";
import { computeWeeklyAwards } from "@/server/repositories/weekly-awards-repository";

export interface WeeklyPipelineResult {
  seasonId: string | null;
  seasonYear: number | null;
  recapWeek: number | null;
  previewWeek: number | null;
  recapsGenerated: number;
  previewsGenerated: number;
  skipped: number;
  synced: boolean;
  note?: string;
}

interface Opts {
  seasonId?: string;
  recapWeek?: number;
  previewWeek?: number;
  sync?: boolean;
}

function framing(a: number, b: number): "blowout" | "nail-biter" | "chalk" {
  const margin = Math.abs(a - b);
  if (margin >= 30) return "blowout";
  if (margin < 7) return "nail-biter";
  return "chalk";
}

async function alreadyGenerated(matchupId: string, type: "MATCHUP_PREVIEW" | "MATCHUP_RECAP"): Promise<boolean> {
  const existing = await prisma.aIContentGeneration.findFirst({
    where: { contentType: type, inputSummary: { path: ["matchupId"], equals: matchupId } },
    select: { id: true },
  });
  return existing != null;
}

export async function generateWeeklyContent(opts: Opts = {}): Promise<WeeklyPipelineResult> {
  let synced = false;
  if (opts.sync) {
    try {
      await syncCurrentLeague();
      synced = true;
    } catch {
      // Sync failure shouldn't abort generation of already-synced data.
    }
  }

  const season = opts.seasonId
    ? await prisma.season.findUnique({ where: { id: opts.seasonId } })
    : (await prisma.season.findFirst({ where: { isCurrent: true } })) ??
      (await prisma.season.findFirst({ where: { status: "COMPLETE" }, orderBy: { year: "desc" } }));

  if (!season) {
    return { seasonId: null, seasonYear: null, recapWeek: null, previewWeek: null, recapsGenerated: 0, previewsGenerated: 0, skipped: 0, synced, note: "No season found." };
  }

  // Derive weeks from the latest week that has final scores, unless overridden.
  const latestFinal = await prisma.matchup.findFirst({
    where: { seasonId: season.id, status: "FINAL", teams: { some: { score: { not: null } } } },
    orderBy: { week: "desc" },
    select: { week: true },
  });
  const recapWeek = opts.recapWeek ?? latestFinal?.week ?? null;
  const previewWeek = opts.previewWeek ?? (recapWeek != null ? recapWeek + 1 : null);

  const safeguards = await getContentSafeguards();
  let recapsGenerated = 0;
  let previewsGenerated = 0;
  let skipped = 0;

  // --- Recaps for the completed week ---
  if (recapWeek != null) {
    const matchups = await prisma.matchup.findMany({
      where: { seasonId: season.id, week: recapWeek, status: "FINAL" },
      include: { teams: { include: { fantasyTeam: { include: { manager: true } } } } },
    });
    for (const m of matchups) {
      if (m.teams.length !== 2 || m.teams.some((t) => t.score == null)) continue;
      if (await alreadyGenerated(m.id, "MATCHUP_RECAP")) {
        skipped += 1;
        continue;
      }
      const [a, b] = m.teams;
      await generateMatchupRecap(
        {
          matchupId: m.id,
          week: m.week,
          season: season.year,
          teamA: { teamName: a.fantasyTeam.teamName, managerName: a.fantasyTeam.manager.displayName, finalScore: a.score! },
          teamB: { teamName: b.fantasyTeam.teamName, managerName: b.fantasyTeam.manager.displayName, finalScore: b.score! },
          keyPerformances: [
            `${a.fantasyTeam.manager.displayName} posted ${a.score!.toFixed(1)}`,
            `${b.fantasyTeam.manager.displayName} posted ${b.score!.toFixed(1)}`,
          ],
          framing: framing(a.score!, b.score!),
        },
        safeguards,
      );
      recapsGenerated += 1;
    }
    // Deterministic weekly awards for the completed week (boom/bust/luck/bench).
    await computeWeeklyAwards(season.id, recapWeek);
  }

  // --- Previews for the upcoming week ---
  if (previewWeek != null) {
    const matchups = await prisma.matchup.findMany({
      where: { seasonId: season.id, week: previewWeek },
      include: { teams: { include: { fantasyTeam: { include: { manager: true } } } } },
    });
    for (const m of matchups) {
      if (m.teams.length !== 2) continue;
      if (await alreadyGenerated(m.id, "MATCHUP_PREVIEW")) {
        skipped += 1;
        continue;
      }
      const [a, b] = m.teams;
      const rec = (t: (typeof m.teams)[number]) =>
        `${t.fantasyTeam.wins}-${t.fantasyTeam.losses}${t.fantasyTeam.ties ? `-${t.fantasyTeam.ties}` : ""}`;
      await generateMatchupPreview(
        {
          matchupId: m.id,
          week: m.week,
          season: season.year,
          teamA: { teamName: a.fantasyTeam.teamName, managerName: a.fantasyTeam.manager.displayName, record: rec(a), recentForm: "", keyPlayers: [] },
          teamB: { teamName: b.fantasyTeam.teamName, managerName: b.fantasyTeam.manager.displayName, record: rec(b), recentForm: "", keyPlayers: [] },
          headToHeadSummary: `${a.fantasyTeam.manager.displayName} vs ${b.fantasyTeam.manager.displayName}`,
        },
        safeguards,
      );
      previewsGenerated += 1;
    }
  }

  return {
    seasonId: season.id,
    seasonYear: season.year,
    recapWeek,
    previewWeek,
    recapsGenerated,
    previewsGenerated,
    skipped,
    synced,
  };
}

/** Fetches any generated preview/recap text for a matchup (for the matchup page). */
export async function getMatchupAIContent(
  matchupId: string,
): Promise<{ preview: string | null; recap: string | null; isMock: boolean }> {
  const [preview, recap] = await Promise.all([
    prisma.aIContentGeneration.findFirst({
      where: { contentType: "MATCHUP_PREVIEW", inputSummary: { path: ["matchupId"], equals: matchupId } },
      orderBy: { generatedAt: "desc" },
    }),
    prisma.aIContentGeneration.findFirst({
      where: { contentType: "MATCHUP_RECAP", inputSummary: { path: ["matchupId"], equals: matchupId } },
      orderBy: { generatedAt: "desc" },
    }),
  ]);
  return {
    preview: preview?.outputText ?? null,
    recap: recap?.outputText ?? null,
    isMock: (preview ?? recap)?.providerName === "mock",
  };
}
