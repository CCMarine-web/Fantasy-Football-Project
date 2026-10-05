import type { ReactNode } from "react";
import { DataFreshness } from "@/components/shared/data-freshness";
import { BrandArt, hasBrandArt } from "@/components/shared/brand-art";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  freshness = false,
  art,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Show "Updated through Week N" — on every page built from league data. */
  freshness?: boolean;
  /**
   * Banner art slot (src/lib/brand-assets.ts), e.g. "header-trade-tribunal".
   * Nothing renders until the art has been ingested, so the header looks the
   * same as it always has in the meantime.
   */
  art?: string;
}) {
  return (
    <>
    {art && hasBrandArt(art) ? (
      <div className="relative mb-6 overflow-hidden rounded-xl border border-border/60">
        <BrandArt
          slot={art}
          eager
          sizes="(max-width: 1280px) 100vw, 1280px"
          className="aspect-[3/1] w-full object-cover sm:aspect-[4/1]"
        />
        <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />
      </div>
    ) : null}
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
    </>
  );
}
