"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveKnowledgeAction } from "./actions";

interface Props {
  id: string;
  title: string;
  body: string;
}

export function KnowledgeEditor({ id, title, body }: Props) {
  const [state, action, pending] = useActionState(saveKnowledgeAction, { message: null });
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="space-y-1">
        <Label htmlFor={`k-title-${id}`}>Title</Label>
        <Input id={`k-title-${id}`} name="title" defaultValue={title} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`k-body-${id}`}>Body</Label>
        <textarea
          id={`k-body-${id}`}
          name="body"
          rows={3}
          defaultValue={body}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save edits"}
        </Button>
        {state.message ? <span className="text-xs text-field">{state.message}</span> : null}
      </div>
    </form>
  );
}
