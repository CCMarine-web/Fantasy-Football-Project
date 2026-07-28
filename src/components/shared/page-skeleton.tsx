/**
 * The placeholder a route shows while its server component is still running.
 *
 * These pages are all `force-dynamic` and several do a dozen queries, so a
 * navigation used to leave the previous page on screen for a beat and then
 * swap the whole thing at once. A skeleton makes the click feel answered and
 * reserves roughly the right amount of space, so the real content does not
 * shove the page around when it lands.
 *
 * Deliberately plain: no spinner, no shimmer that competes with the content
 * that is about to replace it.
 */
export function PageSkeleton({
  rows = 6,
  withHeader = true,
}: {
  /** How many content blocks to reserve space for. */
  rows?: number;
  withHeader?: boolean;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {withHeader ? (
        <div className="space-y-3">
          <div className="h-3 w-28 animate-pulse rounded bg-muted" />
          <div className="h-9 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-xl animate-pulse rounded bg-muted/70" />
        </div>
      ) : null}
      <div className="mt-8 space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="rounded-lg border border-border/60 bg-card/30 p-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
