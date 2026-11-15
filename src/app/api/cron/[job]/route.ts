import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { authorizeCronRequest } from "@/server/jobs/cron-auth";
import { runPipeline, type PipelineJob } from "@/server/pipeline/run";
import { revalidateEverything } from "@/server/pipeline/revalidate";
import { safeError } from "@/server/pipeline/safe-error";

/**
 * The scheduled pipeline (vercel.json `crons`):
 *
 *   GET /api/cron/daily      10:00 UTC every day   light sync + catch-up
 *   GET /api/cron/weekly     13:00 UTC Tuesday     the completed week
 *   GET /api/cron/thursday   13:00 UTC Thursday    stat corrections + previews
 *   GET /api/cron/revalidate (manual / CLI)        clear caches only
 *
 * Every request needs `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron
 * sends automatically. Fails closed: a production build without the secret
 * answers 503 (see server/jobs/cron-auth.ts).
 *
 * 200 on SUCCESS, 207 on PARTIAL, 409 when another run holds the lock, 500
 * only when every step failed — a 500 makes Vercel retry, which is only
 * worth it when nothing worked.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOBS = new Set(["daily", "weekly", "thursday", "revalidate"]);

export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const access = authorizeCronRequest({
    secret: getEnv().CRON_SECRET,
    authorization: request.headers.get("authorization"),
    nodeEnv: process.env.NODE_ENV,
  });
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const { job } = await params;
  if (!JOBS.has(job)) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  try {
    if (job === "revalidate") return NextResponse.json({ ok: true, detail: revalidateEverything() });
    const result = await runPipeline({ job: job as PipelineJob, trigger: "cron" });
    const status =
      result.status === "SUCCESS" ? 200 : result.status === "SKIPPED" ? 409 : result.status === "PARTIAL" ? 207 : 500;
    return NextResponse.json(result, { status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: safeError(err) }, { status: 500 });
  }
}
