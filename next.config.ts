import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * The weekly league hub was called /weekly and is now /matchups. Existing
   * links — bookmarks, anything shared into the group chat over the last year —
   * still work. 308 rather than 307 because the move is permanent and the query
   * string (`?week=4`) is carried across automatically.
   */
  async redirects() {
    return [{ source: "/weekly", destination: "/matchups", permanent: true }];
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
