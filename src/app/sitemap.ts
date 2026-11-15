import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { INDEXABLE_PATHS, canonicalUrl } from "@/lib/indexing";

/** Rebuilt hourly (and whenever the pipeline revalidates the site). */
export const revalidate = 3600;

/**
 * Only the allowlisted pages, on the www host. `lastModified` is the last
 * successful sync, so it moves when the numbers do.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let lastModified: Date | undefined;
  try {
    const sync = await prisma.dataSyncLog.findFirst({
      where: { status: "SUCCESS", finishedAt: { not: null } },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    });
    lastModified = sync?.finishedAt ?? undefined;
  } catch {
    // No database (a database-less build): list the pages without a date.
  }
  return INDEXABLE_PATHS.map((path) => ({
    url: canonicalUrl(path),
    ...(lastModified ? { lastModified } : {}),
    changeFrequency: path === "/about" ? "yearly" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
