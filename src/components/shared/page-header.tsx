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
  /*
   * One compact band (Nov 2026 redesign): eyebrow, title and sync stamp. The
   * description sits under it in small type; methodology lives in collapsed
   * "How it's calculated" blocks further down, never up here. Banner art, when
   * ingested, is a faint backdrop on the right of the band, not a tall image.
   */
  const withArt = Boolean(art && hasBrandArt(art));
  return (
    <div className="border-b border-border pb-4">
      <div className="relative flex flex-col gap-3 overflow-hidden sm:flex-row sm:items-end sm:justify-between">
        {withArt ? (
          <BrandArt
            slot={art as string}
            eager
            sizes="480px"
            className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-1/2 object-cover opacity-25 [mask-image:linear-gradient(to_left,black,transparent)] sm:block"
          />
        ) : null}
        <div className="relative min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {eyebrow ? <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">{eyebrow}</p> : null}
            <h1 className="font-heading text-2xl font-semibold tracking-wide uppercase sm:text-4xl">{title}</h1>
          </div>
          {freshness ? <DataFreshness className="mt-1" /> : null}
        </div>
        {actions ? <div className="relative flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
