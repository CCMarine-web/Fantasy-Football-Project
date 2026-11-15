import { getEnv } from "@/lib/env";

/**
 * Failure alerts, off unless ALERT_WEBHOOK_URL is set (a Discord or Slack
 * incoming webhook). The body carries both `content` (Discord) and `text`
 * (Slack). The message is already scrubbed of secrets by the caller; an alert
 * that fails to send never fails the run.
 */
export async function sendAlert(message: string): Promise<boolean> {
  const url = getEnv().ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message.slice(0, 1900), text: message.slice(0, 3000) }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
