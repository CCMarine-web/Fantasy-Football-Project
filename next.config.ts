import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // AVIF first (roughly 20-30% smaller than WebP at equal quality), WebP as
    // the fallback. The league photos used as page backgrounds are the largest
    // assets on the site, so this is where the bytes are.
    formats: ["image/avif", "image/webp"],
    // Sleeper serves manager avatars; everything else is local /public.
    remotePatterns: [{ protocol: "https", hostname: "sleepercdn.com" }],
    // Backgrounds are decorative and heavily blurred, so long-lived caching is
    // safe and avoids re-running the optimizer.
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
};

export default nextConfig;
