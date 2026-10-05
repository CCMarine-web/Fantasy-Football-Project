import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { BRAND } from "@/lib/branding";

/**
 * The shared frame for every link-preview card (opengraph-image.tsx routes).
 *
 * One layout, one palette, one pair of typefaces, so a matchup pasted into
 * the group chat and a manager profile pasted after it read as the same
 * publication. Satori (behind ImageResponse) does flexbox only, so every
 * element with more than one child is an explicit flex container.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

/** The site's dark theme. One accent; never gold. */
export const OG_COLORS = {
  bg: "#10151b",
  surface: "#161c24",
  border: "rgba(255,255,255,0.1)",
  accent: "#41b0eb",
  text: "#eef3f7",
  muted: "#8b98a5",
} as const;

export const HEADING_FONT = "Oswald";
export const BODY_FONT = "Inter";

type FontOptions = NonNullable<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"]>;

/*
 * Fonts are read once per server process, on the first card rendered — not at
 * import, because every page that has a card imports this module just to read
 * its `alt` and `size`. A failed read is forgotten so the next request retries,
 * and the card still renders in ImageResponse's built-in font.
 */
let fontsPromise: Promise<FontOptions> | null = null;

function loadFonts(): Promise<FontOptions> {
  fontsPromise ??= Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/Oswald-SemiBold.ttf")),
    readFile(join(process.cwd(), "src/assets/fonts/Inter-Regular.ttf")),
    readFile(join(process.cwd(), "src/assets/fonts/Inter-SemiBold.ttf")),
  ]).then(([oswald, interRegular, interSemiBold]) => [
    { name: HEADING_FONT, data: oswald, weight: 600, style: "normal" },
    { name: BODY_FONT, data: interRegular, weight: 400, style: "normal" },
    { name: BODY_FONT, data: interSemiBold, weight: 600, style: "normal" },
  ]);
  fontsPromise.catch(() => {
    fontsPromise = null;
  });
  return fontsPromise;
}

/** The rat emblem (src/app/icon.svg) as a data URI, or null if it cannot be read. */
const MARK_SRC: string | null = (() => {
  try {
    const svg = readFileSync(join(process.cwd(), "src/app/icon.svg"), "base64");
    return `data:image/svg+xml;base64,${svg}`;
  } catch {
    return null;
  }
})();

/** Renders to a finished PNG, so a layout error surfaces here rather than mid-stream. */
async function renderPng(element: ReactElement, fonts: FontOptions | undefined): Promise<Response> {
  const image = new ImageResponse(element, { ...OG_SIZE, fonts, emoji: "twemoji" });
  const body = await image.arrayBuffer();
  return new Response(body, { status: image.status, headers: image.headers });
}

/**
 * Renders a card with the site's fonts. Emoji in team names come from Twemoji;
 * scripts the fonts lack (a team called 鼠年) are fetched from Google Fonts by
 * ImageResponse itself.
 *
 * ImageResponse renders lazily, inside the response stream, so a layout error
 * there would reach the crawler as a broken image. The card is rendered in full
 * first, and anything that goes wrong falls back to the plain brand card.
 *
 * Satori, the renderer, wants every text child as a string: `{13}` throws
 * where `{"13"}` renders. Format numbers before they reach JSX.
 */
export async function ogResponse(element: ReactElement): Promise<Response> {
  let fonts: FontOptions | undefined;
  try {
    fonts = await loadFonts();
  } catch (err) {
    console.error("[og] fonts unavailable, using the built-in font:", err);
  }
  try {
    return await renderPng(element, fonts);
  } catch (err) {
    console.error("[og] card failed to render, serving the brand card:", err);
    return renderPng(<BrandCard />, fonts);
  }
}

/** One decimal, the way every score and figure on the site is printed. */
export function oneDecimal(n: number): string {
  return n.toFixed(1);
}

/** "8-3", or "8-3-1" when there is a tie — the site's record format. */
export function formatRecord(wins: number, losses: number, ties = 0): string {
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

/**
 * A font size at which `text`, set in uppercase Oswald, fits `width` pixels in
 * at most `lines` lines. Oswald is condensed — an average capital is about half
 * an em — and a little slack is left per line for where words happen to break.
 * `lineClamp` on the element is the backstop if the estimate is optimistic.
 */
export function fitFontSize(
  text: string,
  { width, max, min, lines = 1, em = 0.5 }: { width: number; max: number; min: number; lines?: number; em?: number },
): number {
  const chars = Math.max(1, Array.from(text.trim()).length);
  const perLine = lines > 1 ? Math.ceil(chars / lines) + 3 : chars;
  return Math.max(min, Math.min(max, Math.floor(width / (perLine * em))));
}

/** "Blake Mire" -> "BM". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts;
  return letters.map((p) => Array.from(p)[0] ?? "").join("").toUpperCase() || "?";
}

/**
 * A manager photo as a PNG data URI. Photos are local .webp files under
 * /public/managers, which Satori cannot decode, so they are converted with
 * sharp. Anything else (a remote avatar, a missing file, no sharp) returns null
 * and the caller draws initials instead.
 */
export async function managerPhotoSrc(photoUrl: string | null | undefined, px = 280): Promise<string | null> {
  if (!photoUrl) return null;
  const match = /^\/managers\/([a-z0-9][a-z0-9._-]*\.(?:webp|png|jpe?g))$/i.exec(photoUrl);
  if (!match) return null;
  try {
    const { default: sharp } = await import("sharp");
    const file = await readFile(join(process.cwd(), "public", "managers", match[1]));
    const png = await sharp(file).resize(px, px, { fit: "cover", position: "attention" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A round manager portrait, or their initials on the card surface. */
export function Portrait({ src, name, size }: { src: string | null; name: string; size: number }) {
  const ring: CSSProperties = {
    width: size,
    height: size,
    borderRadius: size,
    border: `3px solid ${OG_COLORS.border}`,
  };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} style={{ ...ring, objectFit: "cover" }} />;
  }
  return (
    <div
      style={{
        ...ring,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: OG_COLORS.surface,
        color: OG_COLORS.accent,
        fontFamily: HEADING_FONT,
        fontWeight: 600,
        fontSize: Math.round(size * 0.38),
        letterSpacing: 1,
      }}
    >
      {initials(name)}
    </div>
  );
}

/** The emblem and wordmark, top-left on every card. */
export function Masthead({ size = 48 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size * 0.32) }}>
      {MARK_SRC ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={MARK_SRC} alt="" width={size} height={size} />
      ) : null}
      <div
        style={{
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: Math.round(size * 0.66),
          letterSpacing: Math.max(2, Math.round(size * 0.06)),
          textTransform: "uppercase",
          color: OG_COLORS.text,
        }}
      >
        {BRAND.name}
      </div>
    </div>
  );
}

/** A small uppercase label, e.g. "FINAL" or "CAREER RECORD". */
export function Label({ children, color = OG_COLORS.muted, size = 22 }: { children: ReactNode; color?: string; size?: number }) {
  return (
    <div
      style={{
        fontFamily: HEADING_FONT,
        fontWeight: 600,
        fontSize: size,
        letterSpacing: Math.round(size * 0.16),
        textTransform: "uppercase",
        color,
      }}
    >
      {children}
    </div>
  );
}

/** A raised panel, as cards are on the site. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: OG_COLORS.surface,
        border: `1px solid ${OG_COLORS.border}`,
        borderRadius: 20,
        padding: "26px 30px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const PAGE_STYLE: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  position: "relative",
  background: OG_COLORS.bg,
  backgroundImage: "radial-gradient(circle at 92% -10%, rgba(65,176,235,0.16), rgba(65,176,235,0) 55%)",
  color: OG_COLORS.text,
  fontFamily: BODY_FONT,
  padding: "50px 64px 52px",
};

/**
 * The card layout: masthead, then an accent eyebrow, a big uppercase title and
 * a muted subtitle, then whatever the card is about. Any of the three text
 * slots can be left out; `aside` sits at the masthead's right (a status label).
 */
export function OgFrame({
  eyebrow,
  title,
  titleSize = 76,
  subtitle,
  aside,
  children,
}: {
  eyebrow?: ReactNode;
  title?: string;
  titleSize?: number;
  subtitle?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div style={PAGE_STYLE}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 8, background: OG_COLORS.accent }} />
      <div style={{ display: "flex", flexShrink: 0, alignItems: "center", justifyContent: "space-between" }}>
        <Masthead />
        {aside ? <div style={{ display: "flex" }}>{aside}</div> : null}
      </div>
      {eyebrow ? (
        <div
          style={{
            marginTop: 30,
            flexShrink: 0,
            fontFamily: HEADING_FONT,
            fontWeight: 600,
            fontSize: 28,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: OG_COLORS.accent,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      {title ? (
        <div
          style={{
            display: "block",
            lineClamp: 2,
            marginTop: eyebrow ? 4 : 30,
            flexShrink: 0,
            fontFamily: HEADING_FONT,
            fontWeight: 600,
            fontSize: titleSize,
            lineHeight: 1.08,
            textTransform: "uppercase",
            color: OG_COLORS.text,
          }}
        >
          {title}
        </div>
      ) : null}
      {subtitle ? (
        <div style={{ display: "block", lineClamp: 2, flexShrink: 0, marginTop: 10, fontSize: 28, lineHeight: 1.35, color: OG_COLORS.muted }}>
          {subtitle}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, marginTop: 28 }}>{children}</div>
    </div>
  );
}

/**
 * The plain brand card: the site-wide default, and the fallback for any card
 * whose data cannot be loaded (an unknown id, a database hiccup) — a preview
 * should never be a broken image.
 */
export function BrandCard({ eyebrow }: { eyebrow?: string } = {}) {
  return (
    <div style={{ ...PAGE_STYLE, justifyContent: "center", padding: "64px 88px" }}>
      <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: 8, background: OG_COLORS.accent }} />
      <div style={{ display: "flex", alignItems: "center", gap: 44 }}>
        {MARK_SRC ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={MARK_SRC} alt="" width={196} height={196} />
        ) : null}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontFamily: HEADING_FONT,
              fontWeight: 600,
              fontSize: 26,
              letterSpacing: 6,
              textTransform: "uppercase",
              color: OG_COLORS.accent,
            }}
          >
            {eyebrow ?? BRAND.tagline}
          </div>
          <div
            style={{
              fontFamily: HEADING_FONT,
              fontWeight: 600,
              fontSize: 128,
              lineHeight: 1,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: OG_COLORS.text,
              marginTop: 6,
            }}
          >
            {BRAND.name}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "block",
          lineClamp: 3,
          marginTop: 48,
          maxWidth: 1000,
          fontSize: 30,
          lineHeight: 1.4,
          color: OG_COLORS.muted,
        }}
      >
        {BRAND.description}
      </div>
    </div>
  );
}

/** The brand card as a response — what every dynamic card falls back to. */
export function brandCardResponse(eyebrow?: string): Promise<Response> {
  return ogResponse(<BrandCard eyebrow={eyebrow} />);
}
