import { prisma } from "@/lib/db";
import type { MediaCategory } from "@/generated/prisma/client";

/**
 * Media assets are admin-gated: only APPROVED + isPublished rows are ever
 * returned to public pages. Everything else stays in the admin review queue.
 */

export interface PublishedAsset {
  id: string;
  url: string;
  category: MediaCategory;
  width: number | null;
  height: number | null;
  notes: string | null;
}

/** First published asset for a category (e.g. the homepage hero), or null. */
export async function getPublishedAsset(category: MediaCategory): Promise<PublishedAsset | null> {
  const a = await prisma.mediaAsset.findFirst({
    where: { category, isPublished: true, approvalStatus: "APPROVED" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, url: true, category: true, width: true, height: true, notes: true },
  });
  return a;
}

/** All published assets for a category (e.g. a history gallery). */
export async function listPublishedAssets(category: MediaCategory): Promise<PublishedAsset[]> {
  return prisma.mediaAsset.findMany({
    where: { category, isPublished: true, approvalStatus: "APPROVED" },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, url: true, category: true, width: true, height: true, notes: true },
  });
}
