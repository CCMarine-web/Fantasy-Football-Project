/**
 * Superseded by the pipeline (src/server/pipeline/run.ts), which the cron
 * routes, the admin button and `npm run pipeline` all call. `safeError` is
 * re-exported here for existing importers.
 */
export { safeError } from "@/server/pipeline/safe-error";
