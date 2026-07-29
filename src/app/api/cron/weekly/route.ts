import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { runWeeklyRefresh, safeError } from "@/server/jobs/weekly-refresh";

/**
 * The scheduled weekly refresh.
 *
 * ── Schedule ──────────────────────────────────────────────────────────────
 * `vercel.json` runs this every Tuesday at 12:00 UTC — roughly 07:00 US
 * Central, well after Monday Night Football has finished and Sleeper has
 * settled the week's scoring. Running it any earlier risks recapping a week
 * that is not final, which is the one thing a recap must not do.
 *
 * ── Environment ───────────────────────────────────────────────────────────
 * Required for the job to do anything:
 *   DATABASE_URL         the Supabase pooler connection (already required)
 *   SLEEPER_LEAGUE_ID    without it the sync step is skipped, not failed
 *   OPENAI_API_KEY       without it the writing step is skipped, not failed
 * Strongly recommended:
 *   CRON_SECRET          when set, this endpoint requires
 *                        `Authorization: Bearer <CRON_SECRET>`, which Vercel
 *                        Cron sends automatically. Without it the endpoint is
 *                        open to anyone who guesses the path.
 *
 * No value of any of these is ever written to the response or to the audit log
 * — see `safeError` in server/jobs/weekly-refresh.ts.
 *
 * ── Safe to re-run ────────────────────────────────────────────────────────
 * The job is idempotent, so a duplicate cron firing, a manual re-run, or a
 * retry after a timeout all converge on the same state rather than duplicating
 * transactions or articles.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = getEnv().CRON_SECRET.trim();
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runWeeklyRefresh();
    // 200 even on a partial run: the steps array says what failed, and a 500
    // makes Vercel retry the whole job when most of it succeeded.
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: safeError(err) }, { status: 500 });
  }
}
