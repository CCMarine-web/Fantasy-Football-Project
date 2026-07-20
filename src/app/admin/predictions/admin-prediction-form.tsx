"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAdminPredictionAction, type AdminPredictionState } from "./actions";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Option {
  id: string;
  label: string;
}

interface AdminPredictionFormProps {
  seasons: Option[];
  managers: Option[];
}

const initialState: AdminPredictionState = { message: null, ok: false };

export function AdminPredictionForm({ seasons, managers }: AdminPredictionFormProps) {
  const [state, action, pending] = useActionState(saveAdminPredictionAction, initialState);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="seasonId">Season</Label>
          <select id="seasonId" name="seasonId" className={selectClass} required>
            <option value="">Select…</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="managerId">Prediction by manager</Label>
          <select id="managerId" name="managerId" className={selectClass} required>
            <option value="">Select…</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Predicted final standings (1st → last)</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {managers.map((_, position) => (
            <div key={position} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right font-mono text-sm text-muted-foreground tabular-nums">
                {position + 1}.
              </span>
              <select
                name="standings"
                defaultValue={managers[position]?.id ?? ""}
                className={selectClass}
                aria-label={`Standings position ${position + 1}`}
              >
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="championManagerId">Champion</Label>
          <select id="championManagerId" name="championManagerId" className={selectClass}>
            <option value="">(none)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lastManagerId">Last place</Label>
          <select id="lastManagerId" name="lastManagerId" className={selectClass}>
            <option value="">(none)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bustManagerId">Bust</Label>
          <select id="bustManagerId" name="bustManagerId" className={selectClass}>
            <option value="">(none)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="predictedOwnWins">Predicted own wins</Label>
          <Input id="predictedOwnWins" name="predictedOwnWins" type="number" min={0} max={30} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="predictedOwnLosses">Predicted own losses</Label>
          <Input id="predictedOwnLosses" name="predictedOwnLosses" type="number" min={0} max={30} />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="boldTake">Bold take (optional)</Label>
        <textarea
          id="boldTake"
          name="boldTake"
          rows={2}
          maxLength={2000}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      {state.message ? (
        <p className={state.ok ? "text-sm text-primary" : "text-sm text-destructive"}>
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save prediction (bypass lock)"}
      </Button>
    </form>
  );
}
