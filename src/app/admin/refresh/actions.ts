"use server";

import { auth } from "@/auth";
import { runWeeklyRefresh, safeError, type WeeklyRefreshResult } from "@/server/jobs/weekly-refresh";

export interface RefreshFormState {
  result: WeeklyRefreshResult | null;
  error: string | null;
}

/**
 * The manual "run the weekly refresh now" control.
 *
 * Calls exactly the same job the cron calls, so a manual run cannot produce a
 * different result from a scheduled one. Because the job is idempotent, running
 * it by hand while the cron is mid-run converges rather than duplicating.
 */
export async function runWeeklyRefreshAction(
  _prev: RefreshFormState,
  formData: FormData,
): Promise<RefreshFormState> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return { result: null, error: "Admins only." };
  }

  const skipSync = formData.get("skipSync") === "1";
  try {
    const result = await runWeeklyRefresh({
      skipSync,
      triggeredByUserId: session.user.id ?? null,
    });
    return { result, error: null };
  } catch (err) {
    return { result: null, error: safeError(err) };
  }
}
