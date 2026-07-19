import { prisma } from "@/lib/db";
import type { RecordCategory } from "@/generated/prisma/client";

export async function getCurrentLeagueRecords() {
  const records = await prisma.leagueRecord.findMany({
    where: { supersededAt: null },
    include: { manager: true, season: true },
    orderBy: { recordedAt: "desc" },
  });

  const byCategory = new Map<RecordCategory, (typeof records)[number][]>();
  for (const rec of records) {
    const list = byCategory.get(rec.category) ?? [];
    list.push(rec);
    byCategory.set(rec.category, list);
  }
  return byCategory;
}
