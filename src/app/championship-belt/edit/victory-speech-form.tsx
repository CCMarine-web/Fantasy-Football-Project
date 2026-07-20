"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { saveVictorySpeechAction } from "../actions";

export function VictorySpeechForm({
  seasonId,
  initialSpeech,
}: {
  seasonId: string;
  initialSpeech: string;
}) {
  const [state, action, pending] = useActionState(saveVictorySpeechAction, { message: null });
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <input type="hidden" name="seasonId" value={seasonId} />
      <div className="space-y-1">
        <Label htmlFor="victorySpeech">Victory speech</Label>
        <textarea
          id="victorySpeech"
          name="victorySpeech"
          rows={6}
          defaultValue={initialSpeech}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Let the trash talk flow. What does the champ have to say?"
        />
      </div>
      {state.message ? <p className="text-sm text-field">{state.message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save victory speech"}
      </Button>
    </form>
  );
}
