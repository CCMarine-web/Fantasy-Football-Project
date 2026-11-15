import { prisma } from "@/lib/db";
import { getLeagueClock } from "@/server/league-clock";
import { currentLock } from "./lock";
import { STALE_AFTER_DAYS } from "@/components/layout/staleness-banner";

/**
 * What /api/health reports: is the pipeline running, how current is the data,
 * and is any AI text out of date.
 */
export interface HealthReport {
  ok: boolean;
  checkedAt: string;
  lastSuccessfulSync: string | null;
  lastRun: { job: string; status: string; startedAt: string; finishedAt: string | null; stepReached: string | null } | null;
  lastSuccessfulRun: { job: string; finishedAt: string | null } | null;
  running: { holder: string; expiresAt: string } | null;
  season: number | null;
  phase: string | null;
  lastCompletedWeek: number | null;
  lastStoredWeek: number | null;
  currentWeek: number | null;
  currentWeekState: string | null;
  syncBehind: boolean;
  dataStale: boolean;
  texts: { total: number; stale: number; fallback: number; byKind: Record<string, { total: number; stale: number }>; staleKeys?: string[] } | null;
}

export async function buildHealthReport(
  textStatus: () => Promise<HealthReport["texts"]> = async () => null,
): Promise<HealthReport> {
  const [clock, lastRun, lastSuccessRun, lastSync, lock, texts] = await Promise.all([
    getLeagueClock(),
    prisma.pipelineRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.pipelineRun.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
    prisma.dataSyncLog.findFirst({
      where: { syncType: "FULL_LEAGUE", status: "SUCCESS", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    currentLock(),
    textStatus(),
  ]);
  const lastSuccessfulSync = lastSync?.finishedAt?.toISOString() ?? null;
  const inSeason = clock?.phase === "REGULAR_SEASON" || clock?.phase === "PLAYOFFS";
  const dataStale =
    inSeason && (lastSuccessfulSync == null || Date.now() - Date.parse(lastSuccessfulSync) > STALE_AFTER_DAYS * 86_400_000);
  return {
    ok: !dataStale && (texts == null || texts.stale === 0) && lastRun?.status !== "FAILED",
    checkedAt: new Date().toISOString(),
    lastSuccessfulSync,
    lastRun: lastRun
      ? {
          job: lastRun.job,
          status: lastRun.status,
          startedAt: lastRun.startedAt.toISOString(),
          finishedAt: lastRun.finishedAt?.toISOString() ?? null,
          stepReached: lastRun.stepReached,
        }
      : null,
    lastSuccessfulRun: lastSuccessRun
      ? { job: lastSuccessRun.job, finishedAt: lastSuccessRun.finishedAt?.toISOString() ?? null }
      : null,
    running: lock ? { holder: lock.holder, expiresAt: lock.expiresAt.toISOString() } : null,
    season: clock?.seasonYear ?? null,
    phase: clock?.phase ?? null,
    lastCompletedWeek: clock?.lastCompletedWeek ?? null,
    lastStoredWeek: clock?.lastStoredWeek ?? null,
    currentWeek: clock?.currentWeek ?? null,
    currentWeekState: clock?.currentWeekState ?? null,
    syncBehind: clock?.syncBehind ?? false,
    dataStale,
    texts,
  };
}
