import { prisma } from "@/lib/db";

export async function listPublishedArticles() {
  return prisma.article.findMany({
    where: { status: "PUBLISHED", deletedAt: null },
    include: { season: true },
    orderBy: [{ season: { year: "desc" } }, { week: "desc" }],
  });
}

export async function getArticleBySeasonWeek(year: number, week: number) {
  return prisma.article.findFirst({
    where: { season: { year }, week, status: "PUBLISHED", deletedAt: null },
    include: {
      season: true,
      sections: { orderBy: { order: "asc" }, include: { relatedManager: true } },
    },
  });
}
