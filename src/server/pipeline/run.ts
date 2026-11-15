import { prisma } from "@/lib/db";
import { isSleeperConfigured } from "@/lib/env";
import type { Prisma } from "@/generated/prisma/client";
import { syncCurrentLeague } from "@/server/sleeper";
import { backfillProjections, syncWeekProjections } from "@/server/sleeper/projections";
import { getLeagueClock, type LeagueClock } from "@/server/league-clock";
import { computeWeeklyAwards } from "@/server/repositories/weekly-awards-repository";
import { recomputeRivalryStats } from "@/server/stats/rivalry-recompute";
import { summarizeVerification, verifySeasonData } from "@/server/verify/data-verification";
import { verifyHeadToHeadConsistency } from "@/server/verify/head-to-head-consistency";
import { snapshotPowerRankings } from "./snapshots";
import { runTextGeneration } from "./generate";
import { acquireLock, releaseLock, renewLock } from "./lock";
import { revalidateFromAnywhere } from "./revalidate";
import { sendAlert } from "./alert";
import { safeError } from "./safe-error";

/**
 * THE PIPELINE
 *
 *   sync -> compute -> generate-text -> revalidate
 *
 * One definition of "bring the site up to date", run by three Vercel Cron jobs,
 * the admin button and `npm run pipeline`. Every step is idempotent, so a run
 * that dies part-way is finished by running it again, and a lock stops two runs
 * overlapping.
 *
 * ── Jobs ──────────────────────────────────────────────────────────────────
 *   daily     10:00 UTC every day. Rosters, transactions, scores, Sleeper
 *             state; recompute; regenerate only text whose facts went stale
 *             (a catch-up net, usually nothing); refresh caches.
 *   weekly    Tue 13:00 UTC, after MNF is final. Everything for the completed
 *             week: recaps, power-ranking blurbs, awards copy, rivalry
 *             write-ups for pairs that just met, bios/scouting whose facts
 *             changed, draft revisit commentary, open trade verdicts, the
 *             weekly news issue, and the season retrospective once complete.
 *   thursday  Thu 13:00 UTC, after Wednesday waivers. Stat-correction pass:
 *             re-pull last week's scores; if any changed, recompute (and the
 *             hash check regenerates exactly what depended on them); then
 *             previews for the upcoming week.
 *   manual    Whatever the caller asks for (admin button, CLI backfill).
 *
 * ── Time budget ───────────────────────────────────────────────────────────
 * A Vercel function may run 300 s. Sync and compute take ~30 s; generation
 * runs until the budget is nearly spent and leaves the rest marked stale. The
 * next run (daily at the latest) picks the remainder up, and a stale text is
 * never shown in the meantime — its templated fallback is.
 */

export type PipelineJob = "daily" | "weekly" | "thursday" | "manual";
export type PipelineTrigger = "cron" | "admin" | "cli";
export type StepKey = "sync" | "compute" | "generate-text" | "revalidate";
export type StepStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";

export interface StepResult {
  key: StepKey;
  status: StepStatus;
  detail: string;
  durationMs: number;
  counts?: Record<string, number>;
}

export interface PipelineOptions {
  job: PipelineJob;
  trigger: PipelineTrigger;
  /** Run only these steps (default: all four, in order). */
  steps?: StepKey[];
  /** Backfill: treat this as the completed week (recaps, awards, snapshots). */
  week?: number;
  /** Total wall-clock budget, ms. Default 270 s (under Vercel's 300 s). */
  budgetMs?: number;
  /** Regenerate text even when its facts haven't changed. */
  forceText?: boolean;
  /** Never call the model; write templated text only. */
  noModel?: boolean;
  /** Weeks of missing player projections to backfill this run (default 2). */
  projectionBackfillWeeks?: number;
}

export interface PipelineResult {
  runId: string | null;
  job: PipelineJob;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  seasonYear: number | null;
  week: number | null;
  phase: string | null;
  steps: StepResult[];
  counts: Record<string, number>;
  durationMs: number;
}

export const ALL_STEPS: StepKey[] = ["sync", "compute", "generate-text", "revalidate"];
const DEFAULT_BUDGET_MS = 270_000;

/** Fingerprint of one week's stored scores — what the Thursday pass compares. */
async function scoreFingerprint(seasonId: string, week: number): Promise<string> {
  const rows = await prisma.matchupTeam.findMany({
    where: { matchup: { seasonId, week } },
    select: { fantasyTeamId: true, score: true },
    orderBy: { fantasyTeamId: "asc" },
  });
  return rows.map((r) => `${r.fantasyTeamId}:${r.score?.toFixed(2) ?? "-"}`).join("|");
}

async function timed(key: StepKey, fn: () => Promise<Omit<StepResult, "key" | "durationMs">>): Promise<StepResult> {
  const started = Date.now();
  try {
    const r = await fn();
    return { key, ...r, durationMs: Date.now() - started };
  } catch (err) {
    return { key, status: "FAILED", detail: safeError(err), durationMs: Date.now() - started };
  }
}

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const started = Date.now();
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const wanted = new Set(options.steps ?? ALL_STEPS);
  const steps: StepResult[] = [];
  const counts: Record<string, number> = {};

  const run = await prisma.pipelineRun.create({
    data: { job: options.job, trigger: options.trigger },
    select: { id: true },
  });
  const holder = `${options.job}:${run.id}`;

  if (!(await acquireLock(holder))) {
    const result: PipelineResult = {
      runId: run.id,
      job: options.job,
      status: "SKIPPED",
      seasonYear: null,
      week: null,
      phase: null,
      steps: [{ key: "sync", status: "SKIPPED", detail: "Another pipeline run holds the lock; nothing was done.", durationMs: 0 }],
      counts,
      durationMs: Date.now() - started,
    };
    await prisma.pipelineRun.update({
      where: { id: run.id },
      data: { status: "SKIPPED", steps: result.steps as unknown as Prisma.InputJsonValue, finishedAt: new Date() },
    });
    return result;
  }

  const record = async (stepReached: StepKey) =>
    prisma.pipelineRun.update({
      where: { id: run.id },
      data: { stepReached, steps: steps as unknown as Prisma.InputJsonValue, counts },
    });

  let clock: LeagueClock | null = null;
  try {
    const season =
      (await prisma.season.findFirst({ where: { isCurrent: true } })) ??
      (await prisma.season.findFirst({ orderBy: { year: "desc" } }));

    // ── 1. sync ─────────────────────────────────────────────────────────────
    let correctedScores = false;
    if (wanted.has("sync")) {
      await record("sync");
      steps.push(
        await timed("sync", async () => {
          if (!isSleeperConfigured()) return { status: "SKIPPED", detail: "SLEEPER_LEAGUE_ID is not set." };
          const before = await getLeagueClock();
          const lastWeek = options.week ?? before?.lastStoredWeek ?? null;
          const fingerprintBefore = season && lastWeek ? await scoreFingerprint(season.id, lastWeek) : null;

          const { recordsProcessed } = await syncCurrentLeague();
          counts.recordsSynced = recordsProcessed;

          if (season && lastWeek && fingerprintBefore != null) {
            correctedScores = fingerprintBefore !== (await scoreFingerprint(season.id, lastWeek));
            counts.scoreCorrections = correctedScores ? 1 : 0;
          }
          // Projections: the current week's team totals are refreshed until
          // kickoff and never written after it (a mid-week lineup with empty
          // slots is not a projection); final weeks get player projections.
          let projectionNote = "";
          try {
            const now = await getLeagueClock();
            if (season && now?.currentWeek != null && now.seasonYear === season.year && now.currentWeekState === "UPCOMING") {
              const p = await syncWeekProjections(season.id, now.currentWeek, { overwriteTeams: true });
              counts.teamsProjected = p.teamsProjected;
            }
            const back = await backfillProjections(options.projectionBackfillWeeks ?? 2);
            counts.projectionWeeksBackfilled = back.weeks;
            projectionNote = ` Projections: ${counts.teamsProjected ?? 0} team totals for the current week, ${back.weeks} final week(s) of player projections filled.`;
          } catch (err) {
            projectionNote = ` Projections unavailable: ${safeError(err)}`;
          }
          // Reconcile what was just synced against Sleeper.
          let verifyNote = "";
          let status: StepStatus = "SUCCESS";
          if (season) {
            const v = await verifySeasonData(season.id);
            counts.verificationMismatches = v.errors;
            verifyNote = ` ${summarizeVerification([v])}`;
            if (v.error || v.errors > 0) status = "PARTIAL";
          }
          return {
            status,
            detail: `${recordsProcessed} records synced from Sleeper.${correctedScores ? ` Week ${lastWeek} scores changed (stat correction).` : ""}${projectionNote}${verifyNote}`,
            counts: { recordsSynced: recordsProcessed },
          };
        }),
      );
    }

    clock = await getLeagueClock();
    const week = options.week ?? clock?.lastStoredWeek ?? null;
    await prisma.pipelineRun.update({ where: { id: run.id }, data: { seasonYear: clock?.seasonYear ?? null, week } });

    // ── 2. compute ──────────────────────────────────────────────────────────
    if (wanted.has("compute")) {
      await record("compute");
      steps.push(
        await timed("compute", async () => {
          if (!season) return { status: "SKIPPED", detail: "No season on record." };
          const playedWeeks = await prisma.matchup.findMany({
            where: { seasonId: season.id, isPlayoff: false },
            distinct: ["week"],
            select: { week: true },
            orderBy: { week: "asc" },
          });
          let awards = 0;
          for (const w of playedWeeks) awards += await computeWeeklyAwards(season.id, w.week);
          const pairs = await recomputeRivalryStats();
          const h2h = await verifyHeadToHeadConsistency();
          const snapshots = await snapshotPowerRankings(season.id, season.year, options.week);
          counts.awardRows = awards;
          counts.rivalryPairs = pairs;
          counts.h2hInconsistencies = h2h.problems.length;
          counts.powerSnapshots = snapshots;
          return {
            status: h2h.problems.length ? "PARTIAL" : "SUCCESS",
            detail: `${awards} award rows, ${pairs} rivalry pairs recomputed, ${snapshots} power-ranking snapshot rows; head-to-head consistent across ${h2h.pairsChecked} pairs${h2h.problems.length ? ` EXCEPT ${h2h.problems.length}: ${h2h.problems.map((p) => p.pair).join(", ")}` : ""}.`,
          };
        }),
      );
      await renewLock(holder);
    }

    // ── 3. generate-text ────────────────────────────────────────────────────
    if (wanted.has("generate-text")) {
      await record("generate-text");
      steps.push(
        await timed("generate-text", async () => {
          const remainingMs = budget - (Date.now() - started) - 25_000;
          const r = await runTextGeneration({
            job: options.job,
            clock,
            weekOverride: options.week,
            budgetMs: Math.max(0, remainingMs),
            force: options.forceText ?? false,
            noModel: options.noModel ?? false,
            onProgress: () => renewLock(holder),
          });
          Object.assign(counts, r.counts);
          return { status: r.status, detail: r.detail, counts: r.counts };
        }),
      );
    }

    // ── 4. revalidate ───────────────────────────────────────────────────────
    if (wanted.has("revalidate")) {
      await record("revalidate");
      steps.push(
        await timed("revalidate", async () => {
          const r = await revalidateFromAnywhere();
          return { status: r.ok ? "SUCCESS" : "FAILED", detail: r.detail };
        }),
      );
    }
  } catch (err) {
    steps.push({ key: "sync", status: "FAILED", detail: safeError(err), durationMs: 0 });
  } finally {
    await releaseLock(holder).catch(() => {});
  }

  const failed = steps.filter((s) => s.status === "FAILED");
  const partial = steps.some((s) => s.status === "PARTIAL");
  const status: PipelineResult["status"] =
    failed.length === 0 ? (partial ? "PARTIAL" : "SUCCESS") : failed.length === steps.length ? "FAILED" : "PARTIAL";

  await prisma.pipelineRun.update({
    where: { id: run.id },
    data: {
      status,
      steps: steps as unknown as Prisma.InputJsonValue,
      counts,
      errors: steps.filter((s) => s.status === "FAILED" || s.status === "PARTIAL").map((s) => `${s.key}: ${s.detail}`),
      finishedAt: new Date(),
    },
  });

  if (status === "FAILED" || (status === "PARTIAL" && failed.length > 0)) {
    await sendAlert(
      `Rat Trap pipeline ${options.job} run ${status}: ${steps
        .filter((s) => s.status !== "SUCCESS")
        .map((s) => `${s.key} ${s.status} — ${s.detail}`)
        .join(" | ")}`,
    );
  }

  return {
    runId: run.id,
    job: options.job,
    status,
    seasonYear: clock?.seasonYear ?? null,
    week: options.week ?? clock?.lastStoredWeek ?? null,
    phase: clock?.phase ?? null,
    steps,
    counts,
    durationMs: Date.now() - started,
  };
}
