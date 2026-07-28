import "./lib/load-env";
import { prisma } from "@/lib/db";
async function main() {
  const arts = await prisma.article.findMany({
    where: { season: { year: 2025 } },
    select: { title: true, sections: { orderBy: { order: "asc" }, select: { heading: true, body: true } } },
  });
  for (const a of arts) {
    console.log(`### ${a.title}`);
    for (const s of a.sections) {
      console.log(`\n-- ${s.heading}`);
      console.log(s.body);
    }
  }
  await prisma.$disconnect();
}
main();
