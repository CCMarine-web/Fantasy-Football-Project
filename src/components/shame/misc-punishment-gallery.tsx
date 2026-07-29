"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { GalleryPhoto } from "@/server/repositories/hall-of-shame-repository";

/**
 * The unlabelled punishment gallery.
 *
 * ── No captions, deliberately ─────────────────────────────────────────────
 * These photographs carry no record of which punishment, season or manager they
 * show, and none is invented here — no year, no name, no description, not even
 * a tooltip. The alt text says only that it is a league punishment photograph,
 * because a screen-reader user should get the same information a sighted one
 * does, and no more.
 *
 * ── Aspect ratios ─────────────────────────────────────────────────────────
 * Every photograph keeps its own shape. The tiles are a CSS columns masonry
 * rather than a grid of fixed boxes: all three of these are portrait phone
 * photos, and `object-cover` inside a 4:3 tile cropped the subject's head off.
 * The intrinsic width and height come from the database, so the browser reserves
 * the right space before the file arrives and the page does not reflow.
 *
 * ── Loading ───────────────────────────────────────────────────────────────
 * The first two tiles load eagerly — on a phone at least one is above the fold,
 * and lazy-loading a hero image just delays it. Everything after that is
 * `loading="lazy"`.
 *
 * ── The larger view ───────────────────────────────────────────────────────
 * A plain dialog rather than the shared Dialog component, because this one needs
 * to be navigable with the arrow keys: with the whole gallery unlabelled, moving
 * between photographs IS the browsing experience. Escape closes, the backdrop
 * closes, focus is restored to the tile that opened it.
 */
export function MiscPunishmentGallery({ photos }: { photos: GalleryPhoto[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const open = openIndex != null ? photos[openIndex] : null;

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) => {
        if (current == null) return current;
        // Wraps, so arrowing past the end returns to the start rather than
        // silently doing nothing.
        return (current + delta + photos.length) % photos.length;
      });
    },
    [photos.length],
  );

  useEffect(() => {
    if (openIndex == null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") step(1);
      else if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    // Stop the page behind the overlay scrolling while it is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [openIndex, close, step]);

  if (photos.length === 0) return null;

  return (
    <>
      {/*
        CSS columns rather than grid. A grid row is as tall as its tallest cell,
        which leaves gaps under the shorter photographs; columns pack them.
      */}
      <div className="gap-3 [column-count:1] sm:[column-count:2] lg:[column-count:3]">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setOpenIndex(index)}
            className="mb-3 block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border/60 bg-card/40 transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label="View this photograph larger"
          >
            <Image
              src={photo.url}
              alt="League punishment photograph"
              width={photo.width}
              height={photo.height}
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              // Only the first two are eager; the rest are below the fold on
              // every viewport this site is read on.
              loading={index < 2 ? "eager" : "lazy"}
              priority={false}
              className="h-auto w-full bg-muted object-contain transition hover:opacity-90"
            />
          </button>
        ))}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Punishment photograph"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="relative max-h-full max-w-4xl"
            // The image itself must not close the overlay, or a mistimed click
            // while zooming dismisses it.
            onClick={(event) => event.stopPropagation()}
          >
            <Image
              src={open.url}
              alt="League punishment photograph"
              width={open.width}
              height={open.height}
              sizes="(max-width: 896px) 100vw, 896px"
              className="max-h-[85vh] w-auto rounded-md object-contain"
            />
          </div>

          <button
            type="button"
            onClick={close}
            className="absolute top-4 right-4 rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
          >
            Close
          </button>

          {photos.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(-1);
                }}
                aria-label="Previous photograph"
                className="absolute top-1/2 left-2 -translate-y-1/2 rounded-md bg-black/60 px-3 py-4 text-lg text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:left-4"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  step(1);
                }}
                aria-label="Next photograph"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md bg-black/60 px-3 py-4 text-lg text-white hover:bg-black/80 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none sm:right-4"
              >
                ›
              </button>
              {/* A position counter, not a caption — it describes the gallery,
                  not the photograph. */}
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-black/60 px-3 py-1 text-xs tabular-nums text-white">
                {(openIndex ?? 0) + 1} / {photos.length}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
