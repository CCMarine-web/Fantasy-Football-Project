import "../lib/load-env";
import { readFileSync, existsSync } from "node:fs";
import { prisma } from "@/lib/db";
import { readXlsx } from "./lib/xlsx";
import { collectMeetings, computePair, pairKey, recomputeRivalryStats } from "@/server/stats/rivalry-recompute";

/**
 * Imports the commissioner's official rivalries from the Rivalries workbook and
 * recomputes head-to-head statistics for EVERY pair of managers that has ever
 * met. The workbook is the source of truth for *which* pairings are official;
 * every number is derived from verified matchup results (Sleeper today, ESPN
 * seasons automatically included once imported).
 *
 *   npx tsx scripts/import/import-rivalries.ts --dry-run
 *   npx tsx scripts/import/import-rivalries.ts
 *   npx tsx scripts/import/import-rivalries.ts --file "C:\\path\\Rivalries.xlsx"
 *
 * Nothing here is AI-generated. Rivalry commentary is written separately by
 * scripts/ai/backfill-blurbs.ts from these verified numbers.
 */

const DEFAULT_WORKBOOK = "C:\\Users\\antho\\Downloads\\Rivalries.xlsx";

// --- name resolution --------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** Levenshtein distance — used only to tolerate spelling drift in the sheet. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

interface Candidate {
  managerId: string;
  displayName: string;
  /** Every name we know this manager by. */
  names: string[];
}

/**
 * Resolves a name from the sheet to exactly one manager. Exact (normalized)
 * matches win outright. Otherwise we require a unique close match on BOTH the
 * first name and the surname — spelling drift like "Markemeir" for
 * "Barkemeyer" should resolve, but anything genuinely ambiguous throws rather
 * than risk merging two different people.
 */
function resolveManager(raw: string, candidates: Candidate[]): { managerId: string; how: string } {
  const target = normalize(raw);

  const exact = candidates.filter((c) => c.names.some((n) => normalize(n) === target));
  if (exact.length === 1) return { managerId: exact[0].managerId, how: "exact" };
  if (exact.length > 1) {
    throw new Error(`"${raw}" matches ${exact.length} managers exactly: ${exact.map((c) => c.displayName).join(", ")}`);
  }

  const [rawFirst = "", ...rawRest] = raw.trim().split(/\s+/);
  const rawLast = rawRest.length ? rawRest[rawRest.length - 1] : "";
  if (!rawLast) throw new Error(`"${raw}" has no surname to disambiguate on`);

  const scored: { c: Candidate; dist: number; via: string }[] = [];
  for (const c of candidates) {
    for (const n of c.names) {
      const [nFirst = "", ...nRest] = n.trim().split(/\s+/);
      const nLast = nRest.length ? nRest[nRest.length - 1] : "";
      if (!nLast) continue;
      const firstDist = editDistance(normalize(rawFirst), normalize(nFirst));
      const lastDist = editDistance(normalize(rawLast), normalize(nLast));
      // First names must essentially match; surnames may drift a little.
      if (firstDist <= 1 && lastDist <= 3) scored.push({ c, dist: firstDist + lastDist, via: n });
    }
  }
  if (scored.length === 0) throw new Error(`No manager matches "${raw}"`);

  scored.sort((x, y) => x.dist - y.dist);
  const best = scored[0];
  const bestIds = new Set(scored.filter((s) => s.dist === best.dist).map((s) => s.c.managerId));
  if (bestIds.size > 1) {
    throw new Error(
      `"${raw}" is ambiguous between: ${[...bestIds]
        .map((id) => candidates.find((c) => c.managerId === id)?.displayName)
        .join(", ")} — refusing to guess`,
    );
  }
  return { managerId: best.c.managerId, how: `fuzzy(distance ${best.dist} via "${best.via}")` };
}

// --- main -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileArg = args.indexOf("--file");
  const workbookPath = fileArg >= 0 && args[fileArg + 1] ? args[fileArg + 1] : DEFAULT_WORKBOOK;

  // 1. Official pairings from the workbook.
  const officialPairs: { aRaw: string; bRaw: string }[] = [];
  if (existsSync(workbookPath)) {
    const sheets = readXlsx(workbookPath, readFileSync);
    const sheet = sheets.find((s) => /rival/i.test(s.name)) ?? sheets[0];
    console.log(`Workbook: ${workbookPath}  (sheet "${sheet.name}", ${sheet.rows.length} rows)`);
    for (const row of sheet.rows) {
      const cells = Object.entries(row)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([, v]) => v.trim())
        .filter(Boolean);
      if (cells.length < 2) continue;
      // Skip the header row.
      if (/^rival/i.test(cells[0]) && /^rival/i.test(cells[1])) continue;
      officialPairs.push({ aRaw: cells[0], bRaw: cells[1] });
    }
  } else {
    console.log(`Workbook not found at ${workbookPath} — recomputing stats only, official flags untouched.`);
  }
  // Whether the workbook was actually read. Without it there are no official
  // pairings to assert, so `isOfficial` must be left exactly as it is: writing
  // the empty set would silently un-declare every commissioner rivalry, which
  // is the opposite of what the message above promises.
  const haveWorkbook = existsSync(workbookPath);
  console.log(`Official rivalries in workbook: ${officialPairs.length}`);

  // 2. Candidate names for resolution.
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, aliases: { select: { value: true, aliasType: true } } },
  });
  const candidates: Candidate[] = managers.map((m) => ({
    managerId: m.id,
    displayName: m.displayName,
    names: [
      m.displayName,
      ...m.aliases.filter((a) => a.aliasType === "FULL_NAME" || a.aliasType === "FIRST_NAME").map((a) => a.value),
    ],
  }));

  const officialKeys = new Set<string>();
  for (const p of officialPairs) {
    const a = resolveManager(p.aRaw, candidates);
    const b = resolveManager(p.bRaw, candidates);
    if (a.managerId === b.managerId) throw new Error(`"${p.aRaw}" and "${p.bRaw}" resolved to the same manager`);
    const nameOf = (id: string) => candidates.find((c) => c.managerId === id)!.displayName;
    console.log(`  ${p.aRaw} [${a.how}] -> ${nameOf(a.managerId)}   vs   ${p.bRaw} [${b.how}] -> ${nameOf(b.managerId)}`);
    officialKeys.add(pairKey(a.managerId, b.managerId));
  }

  // 3. Head-to-head stats for every pair that has actually met.
  const byPair = await collectMeetings();
  console.log(`\nPairs with at least one meeting: ${byPair.size}`);

  const missingOfficial = [...officialKeys].filter((k) => !byPair.has(k));
  if (missingOfficial.length) {
    console.log(`Official pairs with no recorded meetings yet: ${missingOfficial.length} (they'll be stored 0-0)`);
  }

  if (dryRun) {
    for (const key of officialKeys) {
      const [a, b] = key.split("|");
      const c = computePair(a, b, byPair.get(key) ?? []);
      const nameOf = (id: string) => candidates.find((x) => x.managerId === id)?.displayName ?? id;
      console.log(
        `  OFFICIAL ${nameOf(a)} vs ${nameOf(b)}: ${c.gamesPlayed} games, ${c.managerAWins}-${c.managerBWins}-${c.ties}, avgMargin=${c.averageMargin}, playoffs=${c.playoffMeetings}`,
      );
    }
    console.log("\n--dry-run: no changes written.");
    return;
  }

  // 4. Persist. Every pair gets stats; only workbook pairs are flagged official.
  const written = await recomputeRivalryStats(haveWorkbook ? { officialKeys } : {});
  console.log(`\nWrote ${written} rivalry row(s); ${officialKeys.size} flagged official.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
