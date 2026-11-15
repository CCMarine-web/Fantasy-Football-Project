import { getEnv } from "@/lib/env";

/**
 * Every secret this process holds, so a thrown error carrying one can be
 * scrubbed before it reaches a log, the run table or an alert. Sleeper's API
 * returns URLs containing the league id, and a misconfigured DATABASE_URL
 * throws with the connection string in the message.
 */
function secretValues(): string[] {
  let values: (string | undefined)[];
  try {
    const env = getEnv();
    values = [
      env.DATABASE_URL,
      env.DIRECT_URL,
      env.AUTH_SECRET,
      env.OPENAI_API_KEY,
      env.XAI_API_KEY,
      env.CRON_SECRET,
      env.ESPN_S2,
      env.ESPN_SWID,
      env.ALERT_WEBHOOK_URL,
    ];
  } catch {
    // getEnv() throws when a required variable is unset — precisely the
    // failure this is most likely scrubbing.
    values = [
      process.env.DATABASE_URL,
      process.env.DIRECT_URL,
      process.env.AUTH_SECRET,
      process.env.OPENAI_API_KEY,
      process.env.XAI_API_KEY,
      process.env.CRON_SECRET,
      process.env.ESPN_S2,
      process.env.ESPN_SWID,
      process.env.ALERT_WEBHOOK_URL,
    ];
  }
  return values.filter((v): v is string => typeof v === "string" && v.length >= 8);
}

/** An error message with any known secret replaced, truncated to one line. */
export function safeError(err: unknown, secrets: string[] = secretValues()): string {
  let message = err instanceof Error ? err.message : String(err);
  for (const secret of secrets) {
    // Values under 8 characters are ignored rather than trusted: redacting a
    // short value would hide the failure, not a credential.
    if (secret && secret.length >= 8) message = message.split(secret).join("[redacted]");
  }
  // Connection strings and URLs can carry credentials that never passed
  // through getEnv(), so strip any userinfo component too.
  message = message.replace(/\/\/[^/\s@]+:[^/\s@]+@/g, "//[redacted]@");
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}
