import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { brandAsset } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";

/**
 * A piece of commissioned artwork, by slot (see src/lib/brand-assets.ts).
 * Until the file has been dropped in /asset-inbox and ingested, `fallback`
 * renders instead, so pages look finished either way and pick the art up
 * without another code change.
 */
export function BrandArt({
  slot,
  alt = "",
  className,
  sizes,
  eager = false,
  fallback = null,
}: {
  slot: string;
  /** Empty for decoration (the default): most art repeats what the text says. */
  alt?: string;
  className?: string;
  sizes?: string;
  /** Above the fold: load immediately at high priority. */
  eager?: boolean;
  fallback?: ReactNode;
}) {
  const asset = brandAsset(slot);
  if (!asset) return <>{fallback}</>;
  return (
    <Image
      src={asset.src}
      alt={alt}
      width={asset.width}
      height={asset.height}
      sizes={sizes}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      className={className}
    />
  );
}

export function hasBrandArt(slot: string): boolean {
  return brandAsset(slot) !== null;
}

/**
 * The stand-in while art is on its way: the brand blue as a halftone screen
 * (the print look the art direction is built on), with an icon from the icon
 * set rather than anything drawn.
 */
export function ArtPlaceholder({ icon: Icon, className }: { icon?: LucideIcon; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-card to-card",
        className,
      )}
    >
      <div className="absolute inset-0 text-primary/25 [background-image:radial-gradient(currentColor_1.2px,transparent_1.6px)] [background-size:9px_9px] [mask-image:radial-gradient(circle_at_70%_30%,black,transparent_75%)]" />
      {Icon ? <Icon className="relative h-2/5 w-2/5 text-primary/70" strokeWidth={1.5} /> : null}
    </div>
  );
}
