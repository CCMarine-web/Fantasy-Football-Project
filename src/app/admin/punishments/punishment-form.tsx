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

export interface PhotoOption {
  id: string;
  url: string;
  originalFilename: string;
  attachedToYear: number | null;
}

export function PunishmentForm({
  managers,
  photos,
}: {
  managers: ManagerOption[];
  photos: PhotoOption[];
}) {
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
      {/*
       * The imported punishment photographs, listed with thumbnails. Their
       * filenames name no year and no manager, so the only way to attach one is
       * for a human to look at it — which means the picture has to be on screen.
       * Picking one here publishes it.
       */}
      {photos.length > 0 ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Punishment photograph (optional)</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex h-full cursor-pointer items-center justify-center rounded-md border border-border/60 bg-background p-2 text-center text-xs has-checked:border-primary has-checked:ring-1 has-checked:ring-primary">
              <input type="radio" name="photoUrl" value="" defaultChecked className="sr-only" />
              No photograph
            </label>
            {photos.map((p) => (
              <label
                key={p.id}
                className="cursor-pointer overflow-hidden rounded-md border border-border/60 has-checked:border-primary has-checked:ring-1 has-checked:ring-primary"
                title={p.originalFilename}
              >
                <input type="radio" name="photoUrl" value={p.url} className="sr-only" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt={p.originalFilename}
                  className="aspect-square w-full bg-muted object-cover"
                />
                <span className="block truncate px-1.5 py-1 text-[11px] text-muted-foreground">
                  {p.attachedToYear ? `in use: ${p.attachedToYear}` : p.originalFilename}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Choosing a photograph approves and publishes it. Anything left unattached stays private.
          </p>
        </fieldset>
      ) : (
        <div className="space-y-1">
          <Label htmlFor="photoUrl">Photo URL or site path (optional)</Label>
          <Input
            id="photoUrl"
            name="photoUrl"
            type="text"
            placeholder="https://… or /punishments/photo.webp"
          />
        </div>
      )}
      {state.message ? <p className="text-sm text-field">{state.message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save punishment"}
      </Button>
    </form>
  );
}
