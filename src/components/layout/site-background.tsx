"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

/**
 * A per-page league photograph behind the content.
 *
 * ── Why the numbers look the way they do ───────────────────────────────────
 * The previous version set the image to `opacity-[0.13]` and then laid a
 * `from-background via-background/85 to-background` gradient over it. Those
 * compound: through the middle of the page the photo survived at
 * 0.13 x 0.15 = ~2%, and at the very top and bottom at 0%. The intent was
 * "13% visible"; the result was a black page.
 *
 * The treatment is now a single, flat scrim so the maths is legible:
 *
 *     effective visibility = IMAGE_OPACITY x (1 - SCRIM_ALPHA)
 *                          = 0.30 x (1 - 0.55)
 *                          = 0.135   -> ~14%, inside the 10-20% target
 *
 * A flat scrim also means the photo is equally present at the top of the page
 * as in the middle, instead of fading out exactly where the masthead sits.
 * The sticky header and the cards carry their own backgrounds, so body copy
 * never sits directly on the brightest part of a photo.
 *
 * A small blur keeps the photos reading as texture rather than as pictures
 * competing with the content, and hides compression artefacts at low opacity.
 */

const IMAGE_OPACITY = 0.3;

interface BackgroundChoice {
  src: string;
  /** Focal point — these are wide crops of group photos. */
  position?: string;
}

/** The eight photographs supplied in the league's picture set. */
const PHOTOS = {
  huddle: { src: "/league/home-screen-background.webp", position: "center 55%" },
  tailgate: { src: "/league/img-0055.webp", position: "center 55%" },
  trophy: { src: "/league/img-0881.webp", position: "center 40%" },
  draftRoom: { src: "/league/img-1296.webp", position: "center 40%" },
  crowd: { src: "/league/img-1297.webp", position: "center 30%" },
  table: { src: "/league/img-1298.webp", position: "center 35%" },
  celebration: { src: "/league/img-1299.webp", position: "center 35%" },
  bar: { src: "/league/img-1300.webp", position: "center 45%" },
} as const satisfies Record<string, BackgroundChoice>;

/**
 * Longest matching prefix wins, so `/managers/[id]` inherits `/managers`.
 * Ordered most-specific first.
 *
 * Eight photos cover ~18 routes, so some are reused — but never on two
 * sections a visitor is likely to move between in one click, which is what
 * makes a site feel like one repeated wallpaper.
 */
const ROUTE_BACKGROUNDS: [string, BackgroundChoice][] = [
  ["/draft-report-cards", PHOTOS.draftRoom],
  ["/drafts", PHOTOS.draftRoom],
  ["/championship-belt", PHOTOS.trophy],
  ["/hall-of-shame", PHOTOS.bar],
  ["/trade-tribunal", PHOTOS.table],
  ["/transactions", PHOTOS.table],
  ["/power-rankings", PHOTOS.crowd],
  ["/predictions", PHOTOS.draftRoom],
  ["/rivalries", PHOTOS.bar],
  ["/standings", PHOTOS.tailgate],
  ["/managers", PHOTOS.celebration],
  ["/matchups", PHOTOS.tailgate],
  ["/records", PHOTOS.trophy],
  ["/history", PHOTOS.crowd],
  ["/news", PHOTOS.table],
  ["/chat-lore", PHOTOS.celebration],
];

function pickBackground(pathname: string): BackgroundChoice | null {
  if (pathname === "/") return PHOTOS.huddle;
  // Admin and auth screens stay plain — they're utilitarian, not editorial.
  if (pathname.startsWith("/admin") || pathname.startsWith("/login")) return null;
  for (const [prefix, choice] of ROUTE_BACKGROUNDS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return choice;
  }
  return null;
}

export function SiteBackground() {
  const pathname = usePathname() ?? "/";
  const choice = pickBackground(pathname);
  if (!choice) return null;

  const isHome = pathname === "/";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Image
        key={choice.src}
        src={choice.src}
        alt=""
        fill
        // Deliberately smaller than the viewport. `sizes="100vw"` made Next
        // request the 3840px variant, upscaling sources that are only
        // 1178-1600px wide and shipping ~4x the bytes for nothing. The image is
        // blurred and sits at 30% opacity, so a 1280px file is indistinguishable
        // from the original on a desktop and much cheaper on a phone.
        sizes="(max-width: 768px) 768px, 1280px"
        priority={isHome}
        loading={isHome ? undefined : "lazy"}
        quality={60}
        className="scale-105 object-cover blur-[3px]"
        style={{ objectPosition: choice.position ?? "center", opacity: IMAGE_OPACITY }}
      />
      {/*
        Flat scrim at a fixed alpha (see the module comment for the arithmetic),
        with a gentle extra wash top and bottom so the sticky header and the
        footer still sit on near-solid colour without dimming the whole page.
      */}
      <div className="bg-background/55 absolute inset-0" />
      <div className="from-background absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent" />
      <div className="from-background absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t to-transparent" />
    </div>
  );
}
