"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveManagerAction } from "./actions";

interface Props {
  manager: {
    id: string;
    displayName: string;
    photoUrl: string | null;
    nickname: string | null;
    nicknameOrigin: string | null;
    signatureMove: string | null;
    bio: string | null;
    noRoast: boolean;
  };
}

export function ManagerEditForm({ manager }: Props) {
  const [state, action, pending] = useActionState(saveManagerAction, { message: null });
  return (
    <form action={action} className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <input type="hidden" name="managerId" value={manager.id} />
      <div className="space-y-1">
        <Label htmlFor="photoUrl">Photo URL (upload the face photo somewhere, or drop it in /public and use /path)</Label>
        <Input id="photoUrl" name="photoUrl" type="url" defaultValue={manager.photoUrl ?? ""} placeholder="https://… or /managers/name.jpg" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="nickname">Nickname</Label>
        <Input id="nickname" name="nickname" defaultValue={manager.nickname ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="nicknameOrigin">Nickname origin story</Label>
        <textarea
          id="nicknameOrigin"
          name="nicknameOrigin"
          rows={2}
          defaultValue={manager.nicknameOrigin ?? ""}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="signatureMove">Signature move</Label>
        <Input id="signatureMove" name="signatureMove" defaultValue={manager.signatureMove ?? ""} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="bio">Bio</Label>
        <textarea
          id="bio"
          name="bio"
          rows={2}
          defaultValue={manager.bio ?? ""}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="noRoast" defaultChecked={manager.noRoast} className="h-4 w-4" />
        No-roast (AI keeps mentions of this manager strictly factual)
      </label>
      {state.message ? <p className="text-sm text-field">{state.message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
