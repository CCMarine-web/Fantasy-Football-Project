import type { ReactNode } from "react";
import { DataFreshness } from "@/components/shared/data-freshness";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  freshness = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Show "Updated through Week N" — on every page built from league data. */
  freshness?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-heading text-3xl font-semibold tracking-wide uppercase sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
        {freshness ? <DataFreshness className="mt-2" /> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
