import "../lib/load-env";
import { prisma } from "@/lib/db";
import { computeTradeTribunal, tradeVerdictKey } from "@/server/repositories/trade-tribunal-repository";

/**
 * One-off migration for the trade-week fix (Oct 2026).
 *
 * Saved trade verdicts were written against a valuation that credited a
 * traded player's trade-week points to the receiver even when the old owner
 * scored them. The corrected valuation changes the band of four trades and the
 * winner of one. Verdicts are now keyed on the hindsight winner; an unkeyed
 * (pre-fix) verdict is hidden until it is either confirmed here or rewritten.
 *
 * A verdict is confirmed — re-keyed to the corrected valuation, text untouched
 * — only when the corrected winner AND band match what it was written from,
 * and its text quotes no figure (any number could be one that moved). The rest
 * stay hidden until regenerated.
 *
 *   npx tsx scripts/import/rekey-trade-verdicts.ts --dry-run
 *   npx tsx scripts/import/rekey-trade-verdicts.ts
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const [before, after] = await Promise.all([
    computeTradeTribunal({ tradeWeekRule: "all" }),
    computeTradeTribunal({ tradeWeekRule: "owner" }),
  ]);
  const beforeById = new Map(before.map((t) => [t.transactionId, t]));
  const saved = await prisma.aIBlurbCache.findMany({
    where: { kind: "TRADE_VERDICT", subjectKey: { in: after.map((t) => t.transactionId) } },
    select: { id: true, subjectKey: true, inputHash: true, text: true },
  });

  let confirmed = 0;
  let held = 0;
  for (const row of saved) {
    if (row.inputHash.startsWith("prov:") || row.inputHash.startsWith("final:")) continue;
    const now = after.find((t) => t.transactionId === row.subjectKey)!;
    const then = beforeById.get(row.subjectKey);
    const sameRuling = then && then.winnerManagerId === now.winnerManagerId && then.lopsidedness === now.lopsidedness;
    const quotesNumbers = /\d/.test(row.text);
    const label = `${now.seasonYear} W${now.week}: ${then?.lopsidedness ?? "?"}→${now.lopsidedness ?? "ungraded"}`;
    if (sameRuling && !quotesNumbers) {
      confirmed += 1;
      console.log(`  confirm  ${label}`);
      if (!dryRun) {
        await prisma.aIBlurbCache.update({ where: { id: row.id }, data: { inputHash: tradeVerdictKey(now) } });
      }
    } else {
      held += 1;
      console.log(`  hold     ${label}${sameRuling ? " (quotes figures)" : " (ruling changed)"}`);
    }
  }
  console.log(`\n${confirmed} confirmed, ${held} held back for rewriting${dryRun ? " (dry run)" : ""}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
