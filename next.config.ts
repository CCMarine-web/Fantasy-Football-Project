import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The weekly league hub was called /weekly and is now /matchups. Existing
   * links — bookmarks, anything shared into the group chat over the last year —
   * still work. 308 rather than 307 because the move is permanent and the query
   * string (`?week=4`) is carried across automatically.
   *
   * /drafts (the board) merged into /draft-report-cards as its Board tab; a
   * `?season=2024` on the old link is carried across the same way.
   */
  async redirects() {
    return [
      /*
       * The old Vercel alias answers with the full site, so it competed with
       * the real domain. 308 to www with the path; Next carries the query
       * string across. (Bare domain -> www and http -> https are Vercel domain
       * settings, not code.)
       */
      {
        source: "/:path*",
        has: [{ type: "host", value: "fantasy-football-project-jade.vercel.app" }],
        destination: "https://www.rattrapfantasy.com/:path*",
        permanent: true,
      },
      { source: "/weekly", destination: "/matchups", permanent: true },
      { source: "/drafts", destination: "/draft-report-cards?tab=board", permanent: true },
    ];
  },
  /**
   * The link-preview cards (opengraph-image routes) read their fonts, the rat
   * mark and the manager photos from disk at request time. Photo paths are
   * built from data, which file tracing can't follow, so without this the
   * deployed function would ship without them and fall back to initials.
   */
  outputFileTracingIncludes: {
    "/**/opengraph-image*": ["src/assets/fonts/**/*", "src/app/icon.svg", "public/managers/**/*"],
  },
  /**
   * The site is never meant to be framed: a page that can be embedded in
   * someone else's frame can have its buttons clickjacked.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No global X-Robots-Tag any more: robots is per route, from the
          // allowlist in lib/indexing.ts (sent by src/proxy.ts).
        ],
      },
    ];
  },
  images: {
    // AVIF first (roughly 20-30% smaller than WebP at equal quality), WebP as
    // the fallback. The league photos used as page backgrounds are the largest
    // assets on the site, so this is where the bytes are.
    formats: ["image/avif", "image/webp"],
    // Sleeper serves manager avatars; everything else is local /public.
    remotePatterns: [{ protocol: "https", hostname: "sleepercdn.com" }],
    // Next 16 only generates the quality levels listed here, and warns (then
    // falls back) for anything else. The blurred page backgrounds request 60
    // deliberately — they are decorative, so the extra compression is free.
    qualities: [60, 75],
    // Backgrounds are decorative and heavily blurred, so long-lived caching is
    // safe and avoids re-running the optimizer.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
