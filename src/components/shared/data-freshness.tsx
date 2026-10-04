import { RefreshCw } from "lucide-react";
import { freshnessLabel, getDataFreshness } from "@/server/repositories/freshness-repository";

/**
 * "Updated through Week 3, 2026 · synced Oct 6, 7:01 AM CDT" — on every page
 * built from league data, so stale numbers are obvious at a glance. Server
 * component; the time is formatted in league time on the server, so there is
 * nothing for the client to disagree with.
 */
export async function DataFreshness({ className = "" }: { className?: string }) {
  const f = await getDataFreshness();
  const synced = f.lastSyncAt
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Chicago",
        timeZoneName: "short",
      }).format(new Date(f.lastSyncAt))
    : null;
  return (
    <p className={`flex items-center gap-1.5 text-xs text-muted-foreground ${className}`}>
      <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        {freshnessLabel(f)}
        {synced ? <span className="text-muted-foreground/80"> · synced {synced}</span> : null}
      </span>
    </p>
  );
}
