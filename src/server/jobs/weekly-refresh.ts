import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getEnv, isAIConfigured, isSleeperConfigured } from "@/lib/env";
import { syncCurrentLeague } from "@/server/sleeper";
import { CACHE_TAGS } from "@/server/cache";
import { getSeasonPhase, type SeasonPhase } from "@/server/repositories/season-phase";
import { computeWeeklyAwards } from "@/server/repositories/weekly-awards-repository";
import { generateWeeklyContent } from "@/server/ai/weekly-pipeline";

/**
 * THE WEEKLY REFRESH
 *
 * One ordered job that brings the whole site up to date. It is what the Vercel
 * cron calls and what the admin "Run now" button calls, so there is exactly one
 * definition of "refresh the site" rather than a cron path and a manual path
 * that drift.
 *
 * ── Order, and why it is fixed ────────────────────────────────────────────
 *   1. SYNC       Pull platform data (matchups, scores, rosters, transactions,
 *                 draft, playoff results) from Sleeper.
 *   2. RECALC     Recompute the deterministic statistics that read that data —
 *                 weekly awards today, and anything else derived from scores.
 *   3. WRITE      Only then generate AI copy, from data that has just been
 *                 verified rather than from whatever was in the database when
 *                 the model happened to be asked.
 *   4. PUBLISH    Invalidate the cached read paths so the site serves the new
 *                 numbers instead of the previous hour's.
 *
 * Generating before syncing is the failure this ordering exists to prevent: a
 * recap written from last week's scores is worse than no recap.
 *
 * ── Idempotence and resumability ──────────────────────────────────────────
 * Every step is safe to run twice and cheap to re-run when its work is already
 * done, which is what makes the job resumable: a run that fails at step 3 is
 * resumed simply by running it again, and steps 1 and 2 no-op through their
 * upserts rather than duplicating anything.
 *
 *   - Transactions upsert on (season, sleeperTransactionId), so a re-sync
 *     updates rather than duplicating. There is no path that creates a second
 *     row for the same Sleeper transaction.
 *   - Matchups are replaced per week, and the human `verifiedScore` judgement
 *     is carried across the replacement (see sync-service.ts).
 *   - Weekly awards upsert on (season, week, type).
 *   - AI previews and recaps are skipped when one already exists for that
 *     matchup, so no article or blurb is ever written twice.
 *
 * A step that throws is recorded and the job continues to the next one, because
 * a Sleeper outage should not stop the awards being recomputed from data
 * already on disk. The result reports exactly what ran and what did not.
 *
 * ── Season awareness ──────────────────────────────────────────────────────
 *   PRESEASON   Before the draft there are no rosters, so nothing
 *               roster-dependent runs: no awards, no previews, no recaps. The
 *               sync still runs — it is how the draft is noticed.
 *   POST_DRAFT  The draft exists but no week has been played. The rosters are
 *               synced and the rankings recomputed; there is still nothing to
 *               recap.
 *   IN_SEASON   Everything runs.
 *
 * ── Logging ───────────────────────────────────────────────────────────────
 * Failures are recorded as a message and a step name. Nothing from the
 * environment is ever included in a logged message — see `safeError`.
 */

export type RefreshStepKey = "SYNC" | "RECALC" | "WRITE" | "PUBLISH";

export type RefreshStepStatus = "SUCCESS" | "FAILED" | "SKIPPED";

export interface RefreshStep {
  key: RefreshStepKey;
  label: string;
  status: RefreshStepStatus;
  /** What happened, in one line. Never contains a secret. */
  detail: string;
  durationMs: number;
}

export interface WeeklyRefreshResult {
  ok: boolean;
  seasonYear: number | null;
  phase: SeasonPhase | null;
  currentWeek: number | null;
  steps: RefreshStep[];
  startedAt: string;
  durationMs: number;
}

export interface WeeklyRefreshOptions {
  /** Skip the platform sync — used when data was just synced by hand. */
  skipSync?: boolean;
  /** Who asked for it, for the audit log. Null for the cron. */
  triggeredByUserId?: string | null;
}

/**
 * Every secret this process holds, so a thrown error carrying one can be
 * scrubbed before it reaches a log. Sleeper's API returns URLs containing the
 * league id, and a misconfigured DATABASE_URL throws with the connection string
 * in the message — neither belongs in an admin panel or a Vercel log line.
 */
function secretValues(): string[] {
  // getEnv() throws when a required variable is unset — which is precisely the
  // failure this function is most likely to be scrubbing. Falling back to the
  // raw process env keeps the redaction working instead of throwing a second
  // error on top of the first.
  let values: (string | undefined)[];
  try {
    const env = getEnv();
    values = [
      env.DATABASE_URL,
      env.DIRECT_URL,
      env.AUTH_SECRET,
      env.OPENAI_API_KEY,
      env.CRON_SECRET,
      env.ESPN_S2,
      env.ESPN_SWID,
    ];
  } catch {
    values = [
      process.env.DATABASE_URL,
      process.env.DIRECT_URL,
      process.env.AUTH_SECRET,
      process.env.OPENAI_API_KEY,
      process.env.CRON_SECRET,
      process.env.ESPN_S2,
      process.env.ESPN_SWID,
    ];
  }
  return values.filter((v): v is string => typeof v === "string" && v.length >= 8);
}

/** An error message with any known secret replaced, truncated to one line. */
export function safeError(err: unknown, secrets: string[] = secretValues()): string {
  let message = err instanceof Error ? err.message : String(err);
  for (const secret of secrets) {
    // Short values are ignored rather than trusted: an env var set to "a" or
    // "dev" would otherwise redact half of every message, hiding the failure
    // instead of the secret. Nothing that short is a credential worth guarding.
    if (secret && secret.length >= 8) message = message.split(secret).join("[redacted]");
  }
  // Connection strings and URLs can carry credentials that never passed through
  // getEnv() (a redirect, a nested cause), so strip any userinfo component too.
  message = message.replace(/\/\/[^/\s@]+:[^/\s@]+@/g, "//[redacted]@");
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function runStep(
  key: RefreshStepKey,
  label: string,
  fn: () => Promise<string>,
): Promise<RefreshStep> {
  const started = Date.now();
  try {
    const detail = await fn();
    return { key, label, status: "SUCCESS", detail, durationMs: Date.now() - started };
  } catch (err) {
    return {
      key,
      label,
      status: "FAILED",
      detail: safeError(err),
      durationMs: Date.now() - started,
    };
  }
}

function skipped(key: RefreshStepKey, label: string, why: string): RefreshStep {
  return { key, label, status: "SKIPPED", detail: why, durationMs: 0 };
}

export async function runWeeklyRefresh(
  options: WeeklyRefreshOptions = {},
): Promise<WeeklyRefreshResult> {
  const startedAt = new Date();
  const steps: RefreshStep[] = [];

  // ── 1. Platform sync ─────────────────────────────────────────────────────
  if (options.skipSync) {
    steps.push(skipped("SYNC", "Sync platform data", "Skipped by request."));
  } else if (!isSleeperConfigured()) {
    steps.push(
      skipped(
        "SYNC",
        "Sync platform data",
        "SLEEPER_LEAGUE_ID is not set, so there is no league to sync from.",
      ),
    );
  } else {
    steps.push(
      await runStep("SYNC", "Sync platform data", async () => {
        const { recordsProcessed } = await syncCurrentLeague();
        return `${recordsProcessed} record${recordsProcessed === 1 ? "" : "s"} synced from Sleeper.`;
      }),
    );
  }

  // The phase is read AFTER the sync, so a draft that completed since the last
  // run is noticed on this run rather than the next one.
  const season =
    (await prisma.season.findFirst({ where: { isCurrent: true } })) ??
    (await prisma.season.findFirst({ orderBy: { year: "desc" } }));

  if (!season) {
    steps.push(skipped("RECALC", "Recalculate statistics", "No season on record."));
    steps.push(skipped("WRITE", "Generate weekly writing", "No season on record."));
    steps.push(skipped("PUBLISH", "Refresh cached pages", "No season on record."));
    return finish(startedAt, steps, null, null, null, options.triggeredByUserId ?? null);
  }

  const phase = await getSeasonPhase(season.id, season.year);

  // ── 2. Deterministic recalculation ───────────────────────────────────────
  if (phase.phase !== "IN_SEASON") {
    steps.push(
      skipped(
        "RECALC",
        "Recalculate statistics",
        phase.phase === "PRESEASON"
          ? "No week has been played and the draft has not happened, so there is nothing to recompute."
          : "The draft is done but no week has been played, so there are no results to recompute.",
      ),
    );
  } else {
    steps.push(
      await runStep("RECALC", "Recalculate statistics", async () => {
        // Awards for every week with scores. Upserted, so re-running a week
        // corrects it rather than adding a second set.
        const weeks = await prisma.matchup.findMany({
          where: { seasonId: season.id, isPlayoff: false, teams: { some: { score: { not: null } } } },
          distinct: ["week"],
          select: { week: true },
          orderBy: { week: "asc" },
        });
        let awards = 0;
        for (const w of weeks) awards += await computeWeeklyAwards(season.id, w.week);
        return `Weekly awards recomputed for ${weeks.length} week${weeks.length === 1 ? "" : "s"} (${awards} award rows). Standings, records, luck and power rankings are derived on read from the synced scores.`;
      }),
    );
  }

  // ── 3. AI writing, only once the data is in ──────────────────────────────
  if (phase.phase !== "IN_SEASON") {
    steps.push(
      skipped(
        "WRITE",
        "Generate weekly writing",
        "Nothing has been played, so there is nothing to recap or preview. Roster-dependent writing is deliberately not run before the season starts.",
      ),
    );
  } else if (!isAIConfigured()) {
    steps.push(
      skipped(
        "WRITE",
        "Generate weekly writing",
        "OPENAI_API_KEY is not set. Placeholder copy is never saved, so the pages keep their honest empty states.",
      ),
    );
  } else {
    steps.push(
      await runStep("WRITE", "Generate weekly writing", async () => {
        // sync:false — step 1 already did it, and doing it twice in one run
        // doubles the Sleeper calls for no benefit.
        const result = await generateWeeklyContent({ sync: false });
        return `${result.recapsGenerated} recap(s) and ${result.previewsGenerated} preview(s) written; ${result.skipped} already existed and were left alone.`;
      }),
    );
  }

  // ── 4. Publish: drop the cached read paths ───────────────────────────────
  steps.push(
    await runStep("PUBLISH", "Refresh cached pages", async () => {
      /*
       * `{ expire: 0 }` rather than the recommended "max" profile: "max" gives
       * stale-while-revalidate, which would serve the previous week's numbers
       * to whoever loads the site first after a sync. The whole point of this
       * step is that the refresh is visible immediately, and one blocking
       * rebuild once a week is a fair price. (updateTag would be the other
       * option, but it may only be called from a Server Action and this job
       * also runs from the cron route handler.)
       */
      for (const tag of Object.values(CACHE_TAGS)) revalidateTag(tag, { expire: 0 });
      return `Invalidated ${Object.values(CACHE_TAGS).length} cache tags, so the next request rebuilds from the new data.`;
    }),
  );

  return finish(
    startedAt,
    steps,
    season.year,
    phase.phase,
    phase.currentWeek,
    options.triggeredByUserId ?? null,
  );
}

async function finish(
  startedAt: Date,
  steps: RefreshStep[],
  seasonYear: number | null,
  phase: SeasonPhase | null,
  currentWeek: number | null,
  triggeredByUserId: string | null,
): Promise<WeeklyRefreshResult> {
  const failures = steps.filter((s) => s.status === "FAILED");
  const ok = failures.length === 0;

  // One audit row per run. The message is already scrubbed of secrets.
  await prisma.dataSyncLog.create({
    data: {
      syncType: "STATS_RECALC",
      status: ok ? "SUCCESS" : steps.some((s) => s.status === "SUCCESS") ? "PARTIAL" : "FAILED",
      recordsProcessed: steps.filter((s) => s.status === "SUCCESS").length,
      errorMessage: ok
        ? null
        : failures.map((f) => `${f.key}: ${f.detail}`).join(" | ").slice(0, 1000),
      triggeredByUserId,
      startedAt,
      finishedAt: new Date(),
    },
  });

  return {
    ok,
    seasonYear,
    phase,
    currentWeek,
    steps,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
  };
}
