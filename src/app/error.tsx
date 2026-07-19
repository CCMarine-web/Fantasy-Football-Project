"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary. Catches any error thrown while rendering a page
 * (most commonly a database connection failure at runtime) and shows a
 * friendly recovery UI instead of Next.js's generic "A server error occurred"
 * 500 page. The root layout still renders around this, so the site nav/footer
 * stay intact.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Logged server-side by Next.js; also log client-side for visibility.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="font-heading text-2xl font-semibold tracking-wide uppercase">
        We couldn&apos;t load this page
      </h1>
      <p className="text-sm text-muted-foreground">
        The Gridiron Gazette had trouble reaching its data. This is usually a temporary connection
        issue — try again in a moment. If it keeps happening, the league database may need to be
        configured or synced.
      </p>
      <Button onClick={reset}>
        <RotateCw className="h-4 w-4" />
        Try again
      </Button>
      {error.digest ? (
        <p className="text-xs text-muted-foreground/70">Reference: {error.digest}</p>
      ) : null}
    </div>
  );
}
