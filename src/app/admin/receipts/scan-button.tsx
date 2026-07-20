"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { scanReceiptsAction, type ScanState } from "./actions";

const INITIAL: ScanState = { message: null };

export function ScanButton() {
  const [state, action, pending] = useActionState(scanReceiptsAction, INITIAL);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Scanning…" : "Scan messages for receipts"}
      </Button>
      {state.message ? <span className="text-sm text-muted-foreground">{state.message}</span> : null}
    </form>
  );
}
