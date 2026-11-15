import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

/**
 * Crawl everything except the private areas, and point at the sitemap.
 *
 * Indexing is decided per page (lib/indexing.ts): most pages answer
 * `noindex, follow`. They are deliberately NOT disallowed here — a crawler
 * that can't fetch a page can't see its noindex. robots.txt is not access
 * control; /admin and the APIs check auth on the server.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/login"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
