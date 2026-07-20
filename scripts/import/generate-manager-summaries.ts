import "dotenv/config";
import { prisma } from "@/lib/db";
import { regenerateManagerPerformanceSummary } from "@/server/repositories/manager-repository";

async function main() {
  const managers = await prisma.manager.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true } });
  for (const m of managers) {
    const r = await regenerateManagerPerformanceSummary(m.id);
    console.log(`${r ? (r.isMock ? "[mock]" : "[ai]") : "[skip]"} ${m.displayName}: ${r ? r.text.slice(0, 90) : "no data"}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
