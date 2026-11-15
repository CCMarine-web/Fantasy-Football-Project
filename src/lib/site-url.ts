/**
 * The one public URL of the site. Canonicals, the sitemap, Open Graph, JSON-LD
 * and the pipeline's post-run checks all build on it, so the site never
 * advertises a deployment alias (*.vercel.app) as its address.
 */
export const DEFAULT_SITE_URL = "https://www.rattrapfantasy.com";

export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
}
