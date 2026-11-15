import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** The 44px tap target with a visible focus ring, shared by every disclosure. */
export const DISCLOSURE_SUMMARY_CLASS =
  "flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-medium outline-none select-none hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden";

/** The chevron that turns when its <details> opens. Place inside a `group` details. */
export function DisclosureChevron({ className }: { className?: string }) {
  return (
    <ChevronDown
      className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180", className)}
      aria-hidden
    />
  );
}

/**
 * Native <details>/<summary>: collapsed by default, but the content is in the
 * initial HTML, so it stays crawlable and works without JavaScript.
 */
export function Disclosure({
  summary,
  children,
  className,
  summaryClassName,
  contentClassName,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  summaryClassName?: string;
  contentClassName?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={cn("group rounded-lg border border-border/60 bg-card/30", className)} open={defaultOpen || undefined}>
      <summary className={cn(DISCLOSURE_SUMMARY_CLASS, summaryClassName)}>
        <span className="min-w-0 flex-1">{summary}</span>
        <DisclosureChevron />
      </summary>
      <div className={cn("px-3 pb-3", contentClassName)}>{children}</div>
    </details>
  );
}
