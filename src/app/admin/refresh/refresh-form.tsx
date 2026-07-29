"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { runWeeklyRefreshAction, type RefreshFormState } from "./actions";

const STATUS_STYLE = {
  SUCCESS: "bg-field text-field-foreground",
  FAILED: "bg-destructive text-destructive-foreground",
  SKIPPED: "",
} as const;

export function WeeklyRefreshForm() {
  const [state, action, pending] = useActionState<RefreshFormState, FormData>(
    runWeeklyRefreshAction,
    { result: null, error: null },
  );

  return (
    <div className="space-y-4">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Running…" : "Run weekly refresh now"}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" name="skipSync" value="1" className="h-4 w-4" />
          Skip the Sleeper sync (recalculate and write from data already stored)
        </label>
      </form>

      {pending ? (
        <p className="text-sm text-muted-foreground">
          Syncing, recalculating, then writing. A full run can take a couple of minutes.
        </p>
      ) : null}

      {state.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {state.result ? (
        <div className="rounded-lg border border-border/60 bg-card/30 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <Badge className={state.result.ok ? "bg-field text-field-foreground" : "bg-destructive text-destructive-foreground"}>
              {state.result.ok ? "Completed" : "Completed with failures"}
            </Badge>
            <span className="text-muted-foreground">
              {state.result.seasonYear ?? "—"} · {state.result.phase ?? "—"}
              {state.result.currentWeek != null ? ` · week ${state.result.currentWeek}` : ""} ·{" "}
              {(state.result.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
          <ul className="space-y-2">
            {state.result.steps.map((step) => (
              <li key={step.key} className="text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={step.status === "SKIPPED" ? "outline" : "default"} className={STATUS_STYLE[step.status]}>
                    {step.status}
                  </Badge>
                  <span className="font-medium">{step.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {(step.durationMs / 1000).toFixed(1)}s
                  </span>
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{step.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
