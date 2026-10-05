import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { BrandArt } from "@/components/shared/brand-art";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/60 bg-card/30 px-6 py-16 text-center">
      {/* One illustration for every empty state once it exists; the icon until then. */}
      <BrandArt
        slot="empty-trap"
        sizes="112px"
        className="h-28 w-28 object-contain"
        fallback={<Icon className="h-8 w-8 text-muted-foreground" aria-hidden />}
      />
      <p className="font-heading text-lg font-semibold uppercase">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
