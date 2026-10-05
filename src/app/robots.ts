import type { MetadataRoute } from "next";

/**
 * Keep the whole site out of search engines. It pairs real names with roasts
 * written for a private league; nobody outside the group chat should find it
 * by searching a manager's name. The robots meta tag (root layout) and the
 * X-Robots-Tag header (next.config.ts) say the same thing to crawlers that
 * ignore this file.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
