import { prisma } from "@/lib/db";
import { getComputedRecords } from "@/server/repositories/computed-records-repository";
import { getHallOfShame, getLastPlaceBySeason } from "@/server/repositories/hall-of-shame-repository";

/**
 * Verified league history for callbacks: who won, who finished last, the
 * records and the shame, back to 2017. Handed to the unhinged voice so a roast
 * can tie this week's disaster to an old one — and since every line here comes
 * from the verified data, the numbers in it pass the stat guard.
 *
 * Built once per process for ten minutes; it changes once a week at most.
 */

let memo: { at: number; text: string } | null = null;
const TTL_MS = 10 * 60_000;

export async function getLeagueLore(): Promise<string> {
  if (memo && Date.now() - memo.at < TTL_MS) return memo.text;
  const text = await buildLeagueLore();
  memo = { at: Date.now(), text };
  return text;
}

async function buildLeagueLore(): Promise<string> {
  const [championships, lastPlace, shame, records, managers, history] = await Promise.all([
    prisma.championship.findMany({
      select: {
        season: { select: { year: true } },
        championManager: { select: { displayName: true } },
        championFantasyTeam: { select: { teamName: true } },
        runnerUpFantasyTeam: { select: { teamName: true, manager: { select: { displayName: true } } } },
      },
      orderBy: { season: { year: "asc" } },
    }),
    getLastPlaceBySeason(),
    getHallOfShame(),
    getComputedRecords(),
    prisma.manager.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, displayName: true } }),
    prisma.leagueHistorySection.findMany({
      where: { approvalStatus: "APPROVED", sensitivity: "NONE", sectionType: { not: "OTHER" } },
      select: { year: true, title: true },
      orderBy: { year: "asc" },
    }),
  ]);

  const lines: string[] = ["LEAGUE LORE (verified — use for callbacks; never invent beyond it):"];

  lines.push("Champions:");
  for (const c of championships) {
    const runnerUp = c.runnerUpFantasyTeam ? `, beat ${c.runnerUpFantasyTeam.manager.displayName} (${c.runnerUpFantasyTeam.teamName})` : "";
    lines.push(`- ${c.season.year}: ${c.championManager.displayName} (${c.championFantasyTeam.teamName})${runnerUp}`);
  }

  // Title droughts, from the same rows.
  const lastTitle = new Map<string, number>();
  for (const c of championships) lastTitle.set(c.championManager.displayName, c.season.year);
  const neverWon = managers.filter((m) => !lastTitle.has(m.displayName)).map((m) => m.displayName);
  if (neverWon.length) lines.push(`Never won a title: ${neverWon.join(", ")}.`);

  lines.push("Regular-season last place:");
  for (const l of [...lastPlace].sort((a, b) => a.year - b.year)) {
    lines.push(`- ${l.year}: ${l.managerName} (${l.teamName}), ${l.record}, ${l.pointsFor.toFixed(1)} points for`);
  }

  lines.push("Hall of Shame:");
  for (const e of shame.entries) lines.push(`- ${e.label}: ${e.value} — ${e.holderName} (${e.detail})`);

  lines.push("Records:");
  for (const r of records) lines.push(`- ${r.label}: ${r.value} — ${r.holderName} (${r.detail})`);

  if (history.length) {
    lines.push("Season stories on record:");
    for (const h of history) lines.push(`- ${h.year}: ${h.title}`);
  }
  return lines.join("\n");
}
