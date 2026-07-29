"use client";

import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface PunishmentGalleryItem {
  id: string;
  year: number;
  managerId: string | null;
  managerName: string | null;
  description: string | null;
  photoUrl: string;
}

/**
 * The punishment wall.
 *
 * Photographs lead, because the photograph IS the record — a paragraph about a
 * man in a chicken suit is not the point. Each tile opens to a full-size view;
 * on a phone the grid collapses to one column so the image is still legible
 * rather than a 90px thumbnail.
 *
 * Only photographs an admin has explicitly attached to a season appear here.
 * The imported files carry no year or name in their filenames, so nothing is
 * guessed at — an unattached photograph stays unpublished.
 */
export function PunishmentGallery({ items }: { items: PunishmentGalleryItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const who = item.managerName ?? "Last place";
        const alt = `${who}, ${item.year} last-place punishment${item.description ? `: ${item.description}` : ""}`;
        return (
          <Dialog
            key={item.id}
            open={openId === item.id}
            onOpenChange={(open) => setOpenId(open ? item.id : null)}
          >
            <DialogTrigger
              className="group overflow-hidden rounded-lg border border-border/60 bg-card/40 text-left transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`View larger: ${alt}`}
            >
              <Image
                src={item.photoUrl}
                alt={alt}
                width={1200}
                height={900}
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                className="aspect-4/3 w-full bg-muted object-cover transition group-hover:opacity-90"
              />
              <div className="p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{item.year}</Badge>
                  <span className="truncate text-sm font-semibold">{who}</span>
                </div>
                {item.description ? (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
              </div>
            </DialogTrigger>

            <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-3xl">
              <DialogTitle>
                {who} — {item.year}
              </DialogTitle>
              <Image
                src={item.photoUrl}
                alt={alt}
                width={1600}
                height={1200}
                sizes="(max-width: 768px) 100vw, 768px"
                className="max-h-[70vh] w-full rounded-md bg-muted object-contain"
              />
              {item.description ? (
                <DialogDescription>{item.description}</DialogDescription>
              ) : null}
            </DialogContent>
          </Dialog>
        );
      })}
    </div>
  );
}
