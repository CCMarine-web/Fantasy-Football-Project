import { BRAND } from "@/lib/branding";
import { brandCardResponse, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/frame";

/**
 * The site-wide link preview: every route without a card of its own inherits
 * this one. Static — no database — so it is rendered once at build time.
 */
export const alt = `${BRAND.name} — ${BRAND.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return brandCardResponse();
}
