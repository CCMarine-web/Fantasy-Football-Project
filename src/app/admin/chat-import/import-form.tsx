"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { runImportAction, type ImportActionState } from "./actions";

const PLATFORMS: { value: string; label: string }[] = [
  { value: "PLAIN_TEXT", label: "Plain text" },
  { value: "IMESSAGE", label: "iMessage" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "GROUPME", label: "GroupMe" },
  { value: "DISCORD", label: "Discord" },
  { value: "CSV", label: "CSV" },
  { value: "JSON", label: "JSON" },
];

const INITIAL: ImportActionState = { ok: false, message: null };

export function ImportForm() {
  const [state, action, pending] = useActionState(runImportAction, INITIAL);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-border/60 bg-card/40 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sourcePlatform">Platform</Label>
          <select
            id="sourcePlatform"
            name="sourcePlatform"
            defaultValue="PLAIN_TEXT"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="originalFileName">File name</Label>
          <Input
            id="originalFileName"
            name="originalFileName"
            placeholder="chat-2020-2023.txt"
            required
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="rawContent">Export contents (paste for now)</Label>
        <textarea
          id="rawContent"
          name="rawContent"
          rows={12}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          placeholder={"2023-09-10 14:32 - Alex: Book it, we win the chip this year"}
        />
        <p className="text-xs text-muted-foreground">
          File upload lands later — for now paste the raw export. Re-importing an overlapping export
          is safe: identical messages are skipped as duplicates.
        </p>
      </div>
      {state.message ? (
        <p className={`text-sm ${state.ok ? "text-field" : "text-destructive"}`}>{state.message}</p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Importing…" : "Run import"}
      </Button>
    </form>
  );
}
