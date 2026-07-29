import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getDraftReportCards, listGradedSeasons } from "@/server/repositories/draft-grade-repository";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { distributePercentages } from "@/lib/format";

/**
 * Checks that every set of weights the site PRINTS adds up to 100%.
 *
 *   npx tsx scripts/audit/weights-audit.ts
 *
 * A published breakdown that sums to 94% or 108% is not a rounding curiosity —
 * it tells a reader the model is not the one being described. The draft report
 * cards advertised seven factors at 27/22/16/14/11/5/5 while the cards beneath
 * them showed five at 30/24/18/15/12, because the panel and the cards derived
 * their weights independently. This asserts they agree, per season.
 */

const TOLERANCE = 0.005; // half a percentage point, after rounding to whole %.

let failures = 0;

/**
 * The percentages the PAGE prints, not the raw shares. Both pages render through
 * distributePercentages, so this audit has to as well — checking the raw sum
 * would have passed while the page displayed 99%.
 */
function check(label: string, weights: { label: string; weight: number }[]) {
  if (weights.length === 0) {
    console.log(`  ${label}: no factors (nothing published)`);
    return;
  }
  const sum = weights.reduce((total, w) => total + w.weight, 0);
  const shown = distributePercentages(weights.map((w) => w.weight));
  const shownSum = shown.reduce((a, b) => a + b, 0);
  const ok = Math.abs(sum - 1) <= TOLERANCE && shownSum === 100;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${label}: raw ${(sum * 100).toFixed(2)}%, as displayed ${shownSum}% ` +
      `(${weights.map((w, i) => `${w.label} ${shown[i]}%`).join(", ")})`,
  );
}

async function main() {
  console.log("=== published weight totals ===\n");

  console.log("power rankings");
  const power = await getPowerRankings();
  if (!power) {
    console.log("  no season to rank");
  } else {
    check(`${power.seasonYear} ${power.mode} — methodology panel`, power.weights);
    // Every card's own breakdown must also total 100%: the per-team factor list
    // is what a reader compares against the panel.
    for (const row of power.rows) {
      check(`${power.seasonYear} ${power.mode} — ${row.managerName}'s breakdown`, row.factors);
    }
  }

  console.log("\ndraft report cards");
  const seasons = await listGradedSeasons();
  for (const { year } of seasons) {
    const view = await getDraftReportCards(year);
    check(`${year} original grade — methodology panel`, view.weights);
    if (view.revisitAvailable) {
      check(`${year} revisited grade — methodology panel`, view.revisitWeights);
    }
    for (const card of view.cards) {
      if (card.factors.length === 0) continue;
      check(`${year} original — ${card.managerName}'s breakdown`, card.factors);
    }
    // The panel and the cards must be describing the same model.
    const panelPct = distributePercentages(view.weights.map((w) => w.weight));
    const panel = view.weights.map((w, i) => `${w.key}:${panelPct[i]}`).join(",");
    for (const card of view.cards) {
      if (card.factors.length === 0) continue;
      const ownPct = distributePercentages(card.factors.map((f) => f.weight));
      const own = card.factors.map((f, i) => `${f.key}:${ownPct[i]}`).join(",");
      if (own !== panel) {
        failures += 1;
        console.log(
          `  FAIL ${year} — ${card.managerName}'s breakdown disagrees with the panel\n` +
            `         panel: ${panel}\n          card: ${own}`,
        );
      }
    }
  }

  console.log("");
  if (failures === 0) {
    console.log("Every published weight set totals 100% and agrees with its panel.");
    return;
  }
  console.log(`${failures} weight problem(s).`);
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
