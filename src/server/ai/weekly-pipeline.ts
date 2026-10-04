// Weekly in-season content pipeline: sync fresh Sleeper data, then generate
// recaps of every completed week and previews up to the next unplayed week,
// storing each as an AIContentGeneration linked (via inputSummary.matchupId) to
// its Matchup so the matchup page can display it. Idempotent — a matchup that
// already has a preview/recap is skipped, so re-running (or the cron firing
// twice) never double-generates, and a missed week is caught up on the next
// run instead of being skipped forever. Degrades to mock content without an
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
  /** The most recent week recapped (or eligible to be), if any. */
  recapWeek: number | null;
  /** The upcoming week previewed, if any. */
  previewWeek: number | null;
  recapsGenerated: number;
  previewsGenerated: number;
  skipped: number;
  synced: boolean;
  note?: string;
}

interface Opts {
  seasonId?: string;
  /** Recap only this week. Default: every final week still missing a recap. */
  recapWeek?: number;
  /** Preview only this week. Default: every week up to the next unplayed one. */
  previewWeek?: number;
  sync?: boolean;
}

/**
 * Generations in flight at once. Each is one model call of tens of seconds;
 * run one after another, a single week's five recaps and five previews
 * overran the cron's 300-second limit and the run was killed mid-write.
 */
const CONCURRENCY = 5;

/** Runs every task, `size` at a time; one failure does not stop the rest. Throws the first failure at the end. */
async function runPool(tasks: (() => Promise<void>)[], size: number): Promise<void> {
  let next = 0;
  const failures: unknown[] = [];
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task().catch((err: unknown) => failures.push(err));
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  if (failures.length > 0) {
    const first = failures[0] instanceof Error ? failures[0].message : String(failures[0]);
    throw new Error(`${failures.length} of ${tasks.length} generations failed; first: ${first}`);
  }
}

function framing(a: number, b: number): "blowout" | "nail-biter" | "chalk" {
  const margin = Math.abs(a - b);
  if (margin >= 30) return "blowout";
  if (margin < 7) return "nail-biter";
  return "chalk";
}

async function generatedMatchupIds(type: "MATCHUP_PREVIEW" | "MATCHUP_RECAP", matchupIds: string[]): Promise<Set<string>> {
  if (matchupIds.length === 0) return new Set();
  const rows = await prisma.aIContentGeneration.findMany({
    where: { contentType: type, OR: matchupIds.map((id) => ({ inputSummary: { path: ["matchupId"], equals: id } })) },
    select: { inputSummary: true },
  });
  return new Set(rows.map((r) => (r.inputSummary as { matchupId?: string } | null)?.matchupId).filter((x): x is string => !!x));
}

type ScoredWeek = { week: number; fantasyTeamId: string; won: boolean | null };

/** Record and last-three form for a team from results before `week`, so a preview never knows the future. */
function formBefore(results: ScoredWeek[], fantasyTeamId: string, week: number): { record: string; recentForm: string } {
  const prior = results.filter((r) => r.fantasyTeamId === fantasyTeamId && r.week < week).sort((a, b) => a.week - b.week);
  const wins = prior.filter((r) => r.won === true).length;
  const losses = prior.filter((r) => r.won === false).length;
  const last = prior.slice(-3).map((r) => (r.won ? "W" : "L"));
  return {
    record: `${wins}-${losses}`,
    recentForm: last.length === 0 ? "season opener — no results yet" : `last ${last.length}: ${last.join("-")}`,
  };
}

/** Top starters by points in one finished week, e.g. "Bijan Robinson (RB) 31.4". */
async function topStarters(fantasyTeamId: string, week: number, n: number): Promise<string[]> {
  const scores = await prisma.weeklyPlayerScore.findMany({
    where: { roster: { fantasyTeamId, week }, isStarter: true, points: { not: null } },
    include: { player: { select: { firstName: true, lastName: true, position: true } } },
    orderBy: { points: "desc" },
    take: n,
  });
  return scores.map((s) => `${s.player.firstName} ${s.player.lastName} (${s.player.position}) ${s.points!.toFixed(1)}`);
}

/** A team's leading starters by total points across its finished weeks before `week`. */
async function keyPlayersBefore(fantasyTeamId: string, week: number, n: number): Promise<string[]> {
  const scores = await prisma.weeklyPlayerScore.findMany({
    where: { roster: { fantasyTeamId, week: { lt: week } }, isStarter: true, points: { not: null } },
    include: { player: { select: { id: true, firstName: true, lastName: true, position: true } } },
  });
  const totals = new Map<string, { label: string; points: number }>();
  for (const s of scores) {
    const t = totals.get(s.player.id) ?? { label: `${s.player.firstName} ${s.player.lastName} (${s.player.position})`, points: 0 };
    t.points += s.points!;
    totals.set(s.player.id, t);
  }
  return [...totals.values()].sort((a, b) => b.points - a.points).slice(0, n).map((t) => t.label);
}

/** All-time head-to-head between two managers from scored games before `season`/`week`. */
async function headToHead(managerA: { id: string; name: string }, managerB: { id: string; name: string }, season: number, week: number): Promise<string> {
  const games = await prisma.matchup.findMany({
    where: {
      status: "FINAL",
      AND: [
        { teams: { some: { fantasyTeam: { managerId: managerA.id }, score: { not: null } } } },
        { teams: { some: { fantasyTeam: { managerId: managerB.id }, score: { not: null } } } },
      ],
      OR: [{ season: { year: { lt: season } } }, { season: { year: season }, week: { lt: week } }],
    },
    include: { teams: { include: { fantasyTeam: { select: { managerId: true } } } } },
  });
  let a = 0;
  let b = 0;
  for (const g of games) {
    const sa = g.teams.find((t) => t.fantasyTeam.managerId === managerA.id)?.score ?? 0;
    const sb = g.teams.find((t) => t.fantasyTeam.managerId === managerB.id)?.score ?? 0;
    if (sa > sb) a += 1;
    else if (sb > sa) b += 1;
  }
  if (a + b === 0) return `${managerA.name} and ${managerB.name} have never met.`;
  if (a === b) return `All-time series tied ${a}-${b}.`;
  return a > b ? `${managerA.name} leads the all-time series ${a}-${b}.` : `${managerB.name} leads the all-time series ${b}-${a}.`;
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

  const matchups = await prisma.matchup.findMany({
    where: { seasonId: season.id },
    include: { teams: { include: { fantasyTeam: { include: { manager: true } } } } },
    orderBy: { week: "asc" },
  });
  const isPlayed = (m: (typeof matchups)[number]) =>
    m.status === "FINAL" && m.teams.length === 2 && m.teams.every((t) => t.score != null);

  const finalWeeks = [...new Set(matchups.filter(isPlayed).map((m) => m.week))];
  const latestFinal = finalWeeks.at(-1) ?? null;
  const nextUnplayed = matchups.find((m) => m.status !== "FINAL")?.week ?? null;

  const recapWeeks = opts.recapWeek != null ? [opts.recapWeek] : finalWeeks;
  const previewWeeks =
    opts.previewWeek != null
      ? [opts.previewWeek]
      : nextUnplayed != null
        ? [...new Set(matchups.filter((m) => m.week <= nextUnplayed).map((m) => m.week))]
        : []; // a finished season has nothing left to preview

  const results: ScoredWeek[] = matchups
    .filter((m) => isPlayed(m) && !m.isPlayoff)
    .flatMap((m) => m.teams.map((t) => ({ week: m.week, fantasyTeamId: t.fantasyTeamId, won: t.isWinner })));

  const safeguards = await getContentSafeguards();
  let recapsGenerated = 0;
  let previewsGenerated = 0;
  let skipped = 0;
  const tasks: (() => Promise<void>)[] = [];

  // --- Recaps for completed weeks ---
  const recapCandidates = matchups.filter((m) => recapWeeks.includes(m.week) && isPlayed(m));
  const recapped = await generatedMatchupIds("MATCHUP_RECAP", recapCandidates.map((m) => m.id));
  for (const m of recapCandidates) {
    if (recapped.has(m.id)) {
      skipped += 1;
      continue;
    }
    tasks.push(async () => {
      const [a, b] = m.teams;
      const [aStars, bStars] = await Promise.all([topStarters(a.fantasyTeamId, m.week, 2), topStarters(b.fantasyTeamId, m.week, 2)]);
      await generateMatchupRecap(
        {
          matchupId: m.id,
          week: m.week,
          season: season.year,
          teamA: { teamName: a.fantasyTeam.teamName, managerName: a.fantasyTeam.manager.displayName, finalScore: a.score! },
          teamB: { teamName: b.fantasyTeam.teamName, managerName: b.fantasyTeam.manager.displayName, finalScore: b.score! },
          keyPerformances: [
            ...aStars.map((p) => `${p} for ${a.fantasyTeam.manager.displayName}`),
            ...bStars.map((p) => `${p} for ${b.fantasyTeam.manager.displayName}`),
          ],
          framing: framing(a.score!, b.score!),
        },
        safeguards,
      );
      recapsGenerated += 1;
    });
  }

  // --- Previews, written from what was known before each week kicked off ---
  const previewCandidates = matchups.filter((m) => previewWeeks.includes(m.week) && m.teams.length === 2);
  const previewed = await generatedMatchupIds("MATCHUP_PREVIEW", previewCandidates.map((m) => m.id));
  for (const m of previewCandidates) {
    if (previewed.has(m.id)) {
      skipped += 1;
      continue;
    }
    tasks.push(async () => {
      const [a, b] = m.teams;
      const side = async (t: typeof a) => ({
        teamName: t.fantasyTeam.teamName,
        managerName: t.fantasyTeam.manager.displayName,
        ...formBefore(results, t.fantasyTeamId, m.week),
        keyPlayers: await keyPlayersBefore(t.fantasyTeamId, m.week, 2),
      });
      const [teamA, teamB, h2h] = await Promise.all([
        side(a),
        side(b),
        headToHead(
          { id: a.fantasyTeam.managerId, name: a.fantasyTeam.manager.displayName },
          { id: b.fantasyTeam.managerId, name: b.fantasyTeam.manager.displayName },
          season.year,
          m.week,
        ),
      ]);
      await generateMatchupPreview({ matchupId: m.id, week: m.week, season: season.year, teamA, teamB, headToHeadSummary: h2h }, safeguards);
      previewsGenerated += 1;
    });
  }

  // Deterministic weekly awards for the completed weeks (boom/bust/luck/bench),
  // before the model calls so a failed generation cannot hold them back.
  for (const week of recapWeeks) await computeWeeklyAwards(season.id, week);

  await runPool(tasks, CONCURRENCY);

  return {
    seasonId: season.id,
    seasonYear: season.year,
    recapWeek: opts.recapWeek ?? latestFinal,
    previewWeek: opts.previewWeek ?? nextUnplayed,
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
