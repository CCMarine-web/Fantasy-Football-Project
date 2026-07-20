"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitPredictionAction, type PredictionFormState } from "./actions";
import type { PredictionManagerOption } from "@/server/repositories/prediction-repository";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface PredictionFormProps {
  seasonId: string;
  managers: PredictionManagerOption[];
  existing: {
    predictedStandings: string[];
    predictedChampionManagerId: string | null;
    predictedLastManagerId: string | null;
    bustManagerId: string | null;
    predictedOwnWins: number | null;
    predictedOwnLosses: number | null;
    boldTake: string | null;
  } | null;
}

const initialState: PredictionFormState = { message: null, ok: false };

export function PredictionForm({ seasonId, managers, existing }: PredictionFormProps) {
  const [state, action, pending] = useActionState(submitPredictionAction, initialState);

  const standingsDefault = (position: number): string =>
    existing?.predictedStandings[position] ?? managers[position]?.id ?? "";

  return (
    <form action={action} className="space-y-8">
      <input type="hidden" name="seasonId" value={seasonId} />

      {/* Predicted final standings */}
      <fieldset className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
        <legend className="px-1 font-heading text-sm font-semibold tracking-wide uppercase">
          Predicted final standings
        </legend>
        <p className="text-xs text-muted-foreground">
          Rank every manager from 1st to last. Each exact hit is worth points.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {managers.map((_, position) => (
            <div key={position} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground tabular-nums">
                {position + 1}.
              </span>
              <select
                name="standings"
                defaultValue={standingsDefault(position)}
                className={selectClass}
                aria-label={`Standings position ${position + 1}`}
              >
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </fieldset>

      {/* Key calls */}
      <fieldset className="grid gap-4 rounded-lg border border-border/60 bg-card/40 p-4 sm:grid-cols-3">
        <legend className="px-1 font-heading text-sm font-semibold tracking-wide uppercase">
          The big calls
        </legend>
        <div className="space-y-1">
          <Label htmlFor="championManagerId">Champion</Label>
          <select
            id="championManagerId"
            name="championManagerId"
            defaultValue={existing?.predictedChampionManagerId ?? ""}
            className={selectClass}
            required
          >
            <option value="">Select…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lastManagerId">Last place</Label>
          <select
            id="lastManagerId"
            name="lastManagerId"
            defaultValue={existing?.predictedLastManagerId ?? ""}
            className={selectClass}
            required
          >
            <option value="">Select…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bustManagerId">Bust of the year</Label>
          <select
            id="bustManagerId"
            name="bustManagerId"
            defaultValue={existing?.bustManagerId ?? ""}
            className={selectClass}
            required
          >
            <option value="">Select…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      {/* Own record + bold take */}
      <fieldset className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
        <legend className="px-1 font-heading text-sm font-semibold tracking-wide uppercase">
          Your own season
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="predictedOwnWins">Predicted wins</Label>
            <Input
              id="predictedOwnWins"
              name="predictedOwnWins"
              type="number"
              min={0}
              max={30}
              defaultValue={existing?.predictedOwnWins ?? ""}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="predictedOwnLosses">Predicted losses</Label>
            <Input
              id="predictedOwnLosses"
              name="predictedOwnLosses"
              type="number"
              min={0}
              max={30}
              defaultValue={existing?.predictedOwnLosses ?? ""}
              required
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="boldTake">Bold take (optional)</Label>
          <textarea
            id="boldTake"
            name="boldTake"
            rows={3}
            maxLength={2000}
            defaultValue={existing?.boldTake ?? ""}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            placeholder="One prediction you'd stake your reputation on…"
          />
        </div>
      </fieldset>

      {state.message ? (
        <p className={state.ok ? "text-sm text-primary" : "text-sm text-destructive"}>
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : existing ? "Update prediction" : "Lock in prediction"}
      </Button>
    </form>
  );
}
