"use client";

import { useId } from "react";

/**
 * The Rat Trap masthead emblem: a rat's head in profile with a wedge of cheese.
 *
 * Drawn as inline SVG rather than an image file so it inherits `currentColor`
 * from the badge (keeping the blue accent defined in one place), costs no extra
 * request, and stays crisp at any density. Original artwork — nothing traced
 * from or hotlinked to an outside source.
 *
 * ── Why it is built from filled shapes and a mask ──────────────────────────
 * A first pass drew this as stroked line art and it turned to mush at the 24px
 * the masthead actually renders it at: overlapping 1.3px strokes merged into a
 * grey lump. Solid silhouettes read instantly at small sizes, so the rat is
 * composed of filled primitives, and the details that need to be legible — the
 * eye, the inner ear, the holes in the cheese — are knocked OUT through a mask
 * rather than drawn on top. The badge colour shows through them, which gives
 * maximum contrast at any size.
 *
 * The mask id is per-instance (`useId`) so multiple emblems on one page cannot
 * collide.
 */
export function RatTrapMark({ className }: { className?: string }) {
  const maskId = useId();

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="A rat with a wedge of cheese"
    >
      <mask id={maskId}>
        {/* In a mask, white keeps the pixel and black removes it. */}
        <g fill="#fff">
          {/* Ear. */}
          <circle cx="9.4" cy="7.6" r="3.1" />
          {/* Head. */}
          <ellipse cx="13.6" cy="12.4" rx="6.6" ry="4.9" />
          {/* Snout tapering to the nose on the right. */}
          <path d="M17.4 9.6 23 12.3c.5.24.5.95 0 1.2l-5.6 2.7z" />
          {/* Cheese wedge in front, resting under the chin. */}
          <path d="M4.9 21.7 12.6 17c.55-.33 1.25.06 1.25.7v3.9c0 .4-.32.72-.72.72H5.28c-.6 0-.83-.72-.38-1.02z" />
        </g>

        <g fill="#000">
          {/* Inner ear. */}
          <circle cx="9.4" cy="7.6" r="1.35" />
          {/* Eye. */}
          <circle cx="15.1" cy="11.2" r="1.15" />
          {/* Nostril, right at the tip of the snout. */}
          <circle cx="21.4" cy="12.9" r="0.62" />
          {/* Holes in the cheese. */}
          <circle cx="11.4" cy="20.2" r="0.85" />
          <circle cx="8.2" cy="21.4" r="0.6" />
          {/* A sliver of separation so the cheese reads as a separate object
              rather than merging into the jaw. */}
          <path d="M13.2 16.1 5.6 20.7l-.55-.9 7.6-4.6z" />
        </g>
      </mask>

      {/* One flat fill, shaped entirely by the mask above. */}
      <rect width="24" height="24" fill="currentColor" mask={`url(#${maskId})`} />

      {/*
        Tail and whiskers are strokes, not masked fills. A filled tail at this
        size collapsed into a detached blob to the left of the head; a single
        open curve stays legible because nothing overlaps it.
      */}
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M7.6 15.4c-2 1.5-4.6 1.2-5.4-.5-.5-1.1.2-2.2 1.3-2.2.8 0 1.3.6 1.1 1.3"
          strokeWidth="1.35"
        />
        <g strokeWidth="0.9" opacity="0.75">
          <path d="M19.6 15.4 22.6 17" />
          <path d="M19.1 16.3 21 18.4" />
        </g>
      </g>
    </svg>
  );
}
