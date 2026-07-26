"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

/**
 * A subtle, per-page league photograph behind the content.
 *
 * Treatment: the image sits at low opacity behind a two-stop scrim (opaque at
 * the top and bottom, semi-transparent in the middle) plus a slight blur, so
 * body copy keeps full contrast against the dark theme and the photo reads as
 * texture rather than a picture. Different sections get different photos so
 * the site doesn't feel like one repeated wallpaper.
 *
 * Cost control: exactly one image per route, `fill` + `sizes="100vw"` so Next
 * serves a viewport-appropriate AVIF/WebP, and only the homepage image is
 * marked priority — every other route lazy-loads it.
 */

interface BackgroundChoice {
  src: string;
  /** Focal point, since these are wide crops of group photos. */
  position?: string;
}

/**
 * Longest matching prefix wins, so `/managers/[id]` inherits `/managers`.
 * Ordered most-specific first.
 */
const ROUTE_BACKGROUNDS: [string, BackgroundChoice][] = [
  ["/draft-report-cards", { src: "/league/img-1296.webp", position: "center 40%" }],
  ["/drafts", { src: "/league/img-1296.webp", position: "center 40%" }],
  ["/championship-belt", { src: "/league/img-1299.webp", position: "center 35%" }],
  ["/hall-of-shame", { src: "/league/img-1300.webp", position: "center 45%" }],
  ["/trade-tribunal", { src: "/league/img-1298.webp", position: "center 30%" }],
  ["/transactions", { src: "/league/img-1297.webp", position: "center 25%" }],
  ["/power-rankings", { src: "/league/img-0881.webp", position: "center 60%" }],
  ["/predictions", { src: "/league/img-1296.webp", position: "center 40%" }],
  ["/rivalries", { src: "/league/img-1300.webp", position: "center 45%" }],
  ["/standings", { src: "/league/img-0055.webp", position: "center 55%" }],
  ["/managers", { src: "/league/img-1299.webp", position: "center 35%" }],
  ["/matchups", { src: "/league/img-0055.webp", position: "center 55%" }],
  ["/records", { src: "/league/img-1298.webp", position: "center 30%" }],
  ["/history", { src: "/league/img-1297.webp", position: "center 25%" }],
  ["/news", { src: "/league/img-1298.webp", position: "center 30%" }],
];

const HOME: BackgroundChoice = { src: "/league/home-screen-background.webp", position: "center 55%" };

function pickBackground(pathname: string): BackgroundChoice | null {
  if (pathname === "/") return HOME;
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
        sizes="100vw"
        priority={isHome}
        loading={isHome ? undefined : "lazy"}
        quality={60}
        className="scale-105 object-cover opacity-[0.13] blur-[2px]"
        style={{ objectPosition: choice.position ?? "center" }}
      />
      {/* Scrim: solid behind the header and footer, lighter through the middle. */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background/85 to-background" />
    </div>
  );
}
