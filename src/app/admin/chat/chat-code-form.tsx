"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { issueChatCodeAction, type ChatCodeState } from "./actions";

interface ManagerOption {
  id: string;
  displayName: string;
  hasCode: boolean;
}

/**
 * Issues and revokes manager chat codes.
 *
 * The plaintext code appears exactly once, right after it is generated, because
 * only its hash is stored. That is deliberate and is called out in the UI so an
 * admin knows to copy it before navigating away.
 */
export function ChatCodeForm({ managers }: { managers: ManagerOption[] }) {
  const [state, action, pending] = useActionState<ChatCodeState, FormData>(issueChatCodeAction, {
    managerName: null,
    code: null,
    message: null,
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {managers.map((m) => (
          <form
            key={m.id}
            action={action}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
          >
            <input type="hidden" name="managerId" value={m.id} />
            <input type="hidden" name="managerName" value={m.displayName} />
            <span className="min-w-0 flex-1 truncate font-medium">{m.displayName}</span>
            <span className="text-xs text-muted-foreground">
              {m.hasCode ? "code issued" : "no code — name fully reserved"}
            </span>
            <Button type="submit" size="sm" variant="outline" disabled={pending}>
              {m.hasCode ? "Reissue" : "Issue code"}
            </Button>
            {m.hasCode ? (
              <Button
                type="submit"
                name="revoke"
                value="1"
                size="sm"
                variant="ghost"
                disabled={pending}
                className="text-destructive"
              >
                Revoke
              </Button>
            ) : null}
          </form>
        ))}
      </div>

      {state.code ? (
        <div className="rounded-md border border-primary/50 bg-primary/10 px-3 py-3">
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {state.managerName}&rsquo;s code — shown once
          </p>
          <p className="mt-1 font-mono text-lg font-semibold break-all select-all">{state.code}</p>
          <p className="mt-1 text-xs text-muted-foreground">{state.message}</p>
        </div>
      ) : state.message ? (
        <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
