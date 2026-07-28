import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getManagerProfileDetailed } from "@/server/repositories/manager-repository";

/**
 * Cross-examines every saved manager bio against the statistics printed beside
 * it on the same page.
 *
 *   npx tsx scripts/ai/verify-manager-bios.ts
 *   npx tsx scripts/ai/verify-manager-bios.ts --clear-mismatched
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * A generated bio can be fluent, cite real-looking numbers, and still disagree
 * with the table next to it. One run produced "career record sits at 62-84"
 * for a manager whose career row read 50-76 — the packet had counted playoff
 * games into a figure the page reports as regular season. Nothing about the
 * prose looked wrong; only a comparison catches it.
 *
 * ── What it checks ────────────────────────────────────────────────────────
 *  - Any W-L pair quoted as a record matches the career, an era, or a season
 *    row shown on the page.
 *  - Championship and playoff-appearance counts are not overstated.
 *  - Years mentioned fall inside the manager's actual span.
 *  - Era claims ("on ESPN he was X-Y") match that era's row.
 *  - No packet field names leaked into the prose.
 */

interface Finding {
  manager: string;
  problem: string;
  detail: string;
}

const FIELD_NAME_PATTERN =
  /\b(recentPointsPerGame|careerPointsPerGame|allPlayWinPct|allPlayRecord|winPct|luckLabel|recentTrajectory|statsComplete|bestFinish|worstFinish|playoffAppearances|finalsAppearances|championshipYears|pointsForPerGame|topRivalries|communicationStyle|personalityProfile|leagueVoice|approvedKnowledge|historyNotes|seasonsPlayed|currentTeamName|yearsActive|regularSeasonRank|finalRank|madePlayoffs|isChampion|postseasonRecord|playoffRecord|consolationRecord|luckScore|luckSummary)\b/;

async function main() {
  const clear = process.argv.includes("--clear-mismatched");

  const summaries = await prisma.managerPerformanceSummary.findMany({
    where: { isMock: false },
    select: { managerId: true, summary: true, manager: { select: { displayName: true } } },
  });

  console.log(`=== manager bio verification ===\nchecking ${summaries.length} bio(s)\n`);
  const findings: Finding[] = [];

  for (const row of summaries) {
    const name = row.manager.displayName;
    const text = row.summary;
    const profile = await getManagerProfileDetailed(row.managerId);
    if (!profile) continue;

    const played = profile.seasonLines.filter((l) => l.wins + l.losses + l.ties > 0);

    // Every record the page actually displays, in "W-L" and "W-L-T" form.
    const validRecords = new Set<string>();
    for (const era of profile.eraStats) {
      validRecords.add(`${era.wins}-${era.losses}`);
      if (era.ties) validRecords.add(`${era.wins}-${era.losses}-${era.ties}`);
      // Championship bracket and consolation are shown as separate columns,
      // so both are quotable — but their SUM is not, because the page never
      // presents one combined postseason record.
      validRecords.add(`${era.playoffWins}-${era.playoffLosses}`);
      validRecords.add(`${era.consolationWins}-${era.consolationLosses}`);
    }
    for (const line of played) {
      validRecords.add(`${line.wins}-${line.losses}`);
      if (line.ties) validRecords.add(`${line.wins}-${line.losses}-${line.ties}`);
    }
    for (const h of profile.headToHead) {
      validRecords.add(`${h.wins}-${h.losses}`);
      validRecords.add(`${h.losses}-${h.wins}`);
      if (h.ties) validRecords.add(`${h.wins}-${h.losses}-${h.ties}`);
    }
    validRecords.add(`${profile.stats.allPlay.wins}-${profile.stats.allPlay.losses}`);

    // 1. Records quoted in the prose.
    for (const match of text.matchAll(
      /\b(\d{1,3})\s*[-–]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,2}))?\b/g,
    )) {
      const [whole, a, b, t] = match;
      // Skip year ranges ("2017-2022") and point totals ("1,954.5-1,700").
      if (Number(a) > 1900 || Number(b) > 1900) continue;
      if (Number(a) > 200 || Number(b) > 200) continue;
      // Skip spans that are plainly not records: "Weeks 16-17", "rounds 1-5".
      // Without this, an ordinary sentence about the fantasy playoff weeks gets
      // reported as an invented win-loss line.
      const preceding = text.slice(Math.max(0, (match.index ?? 0) - 14), match.index ?? 0);
      if (/\b(week|weeks|wk|round|rounds|pick|picks|day|days)\s*$/i.test(preceding)) continue;
      const candidate = t ? `${a}-${b}-${t}` : `${a}-${b}`;
      if (!validRecords.has(candidate)) {
        findings.push({
          manager: name,
          problem: "record not shown on the page",
          detail: `bio quotes "${whole.trim()}" but no career, era, season or head-to-head row matches it`,
        });
      }
    }

    // 2. Championship count must not be overstated.
    const titles = profile.stats.championships;
    for (const match of text.matchAll(/\b(\d{1,2})\s+(championships?|titles?|rings?)\b/gi)) {
      if (Number(match[1]) > titles) {
        findings.push({
          manager: name,
          problem: "championship count",
          detail: `bio says "${match[0]}" but ${titles} are on record`,
        });
      }
    }
    if (
      titles === 0 &&
      /\b(won the (title|league|championship)|his championship|a championship season)\b/i.test(text)
    ) {
      const negated = /\b(no|never|without|yet to|still|drought|title-less|titleless)\b/i.test(
        text,
      );
      if (!negated) {
        findings.push({
          manager: name,
          problem: "championship claimed",
          detail: "bio implies a title but none is on record",
        });
      }
    }

    // 3. Playoff appearances must not be overstated.
    for (const match of text.matchAll(
      /\b(\d{1,2})\s+playoff\s+(appearances?|berths?|trips?)\b/gi,
    )) {
      if (Number(match[1]) > profile.stats.playoffAppearances) {
        findings.push({
          manager: name,
          problem: "playoff appearances",
          detail: `bio says "${match[0]}" but ${profile.stats.playoffAppearances} are on record`,
        });
      }
    }

    // 4. Seasons referenced must be seasons they actually played.
    const playedYears = new Set(played.map((l) => l.year));
    for (const match of text.matchAll(/\b(20\d{2})\b/g)) {
      const year = Number(match[1]);
      // A trailing year in a range like "2017-2022" is fine, as is next season.
      const maxYear = Math.max(...playedYears);
      if (!playedYears.has(year) && year <= maxYear) {
        findings.push({
          manager: name,
          problem: "season not played",
          detail: `bio mentions ${year}, which is not one of this manager's seasons (${[...playedYears].sort().join(", ")})`,
        });
      }
    }

    // 5. Leaked packet identifiers.
    const leak = text.match(FIELD_NAME_PATTERN);
    if (leak) {
      findings.push({
        manager: name,
        problem: "leaked field name",
        detail: `prose contains the packet key "${leak[0]}"`,
      });
    }
  }

  if (findings.length === 0) {
    console.log("No contradictions found — every bio agrees with the statistics on its page.");
    return;
  }

  const byManager = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byManager.get(f.manager) ?? [];
    list.push(f);
    byManager.set(f.manager, list);
  }

  console.log(`${findings.length} issue(s) across ${byManager.size} manager(s):\n`);
  for (const [manager, list] of byManager) {
    console.log(`  ${manager}`);
    for (const f of list) console.log(`      [${f.problem}] ${f.detail}`);
  }

  if (clear) {
    const ids = [...byManager.keys()];
    const { count } = await prisma.managerPerformanceSummary.deleteMany({
      where: { manager: { displayName: { in: ids } } },
    });
    console.log(
      `\nDeleted ${count} bio(s). Re-run scripts/ai/regenerate-manager-profiles.ts to rewrite them.`,
    );
  } else {
    console.log("\nRe-run with --clear-mismatched to delete these and regenerate.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
