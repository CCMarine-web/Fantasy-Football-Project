"use server";

import { auth } from "@/auth";
import { runPipeline, type PipelineJob, type PipelineResult } from "@/server/pipeline/run";
import { safeError } from "@/server/pipeline/safe-error";

export interface RefreshFormState {
  result: PipelineResult | null;
  error: string | null;
}

/**
 * The manual "run the pipeline now" control. Calls exactly the same pipeline
 * the cron jobs call, so a manual run cannot differ from a scheduled one, and
 * takes the same lock, so it cannot overlap one either.
 */
export async function runWeeklyRefreshAction(_prev: RefreshFormState, formData: FormData): Promise<RefreshFormState> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") return { result: null, error: "Admins only." };

  const requested = String(formData.get("job") ?? "weekly");
  const job: PipelineJob = requested === "daily" || requested === "thursday" ? requested : "weekly";
  const skipSync = formData.get("skipSync") === "1";
  try {
    const result = await runPipeline({
      job,
      trigger: "admin",
      steps: skipSync ? ["compute", "generate-text", "revalidate"] : undefined,
    });
    return { result, error: null };
  } catch (err) {
    return { result: null, error: safeError(err) };
  }
}
