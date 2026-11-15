import { NextResponse } from "next/server";
import { buildHealthReport } from "@/server/pipeline/health";
import { safeError } from "@/server/pipeline/safe-error";

/**
 * GET /api/health — last successful sync, current season/week/phase, the last
 * pipeline run, and how many AI texts are out of date. Public and read-only:
 * nothing here is sensitive, and an uptime monitor can poll it without a key.
 * 200 when healthy, 503 when data or text is stale or the last run failed.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const report = await buildHealthReport();
    return NextResponse.json(report, {
      status: report.ok ? 200 : 503,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: safeError(err) }, { status: 500 });
  }
}
