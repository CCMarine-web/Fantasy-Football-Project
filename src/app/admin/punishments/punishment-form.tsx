"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { savePunishmentAction } from "./actions";

interface ManagerOption {
  id: string;
  displayName: string;
}

export function PunishmentForm({ managers }: { managers: ManagerOption[] }) {
  const [state, action, pending] = useActionState(savePunishmentAction, { message: null });
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="year">Season year</Label>
          <Input id="year" name="year" type="number" placeholder="2025" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="managerId">Last-place manager</Label>
          <select
            id="managerId"
            name="managerId"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">(none / unknown)</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="description">Punishment</Label>
        <textarea
          id="description"
          name="description"
          rows={3}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="e.g. Had to get a tattoo chosen by the league…"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="photoUrl">Photo URL (optional)</Label>
        <Input id="photoUrl" name="photoUrl" type="url" placeholder="https://… or /managers/photo.jpg" />
      </div>
      {state.message ? <p className="text-sm text-field">{state.message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save punishment"}
      </Button>
    </form>
  );
}
