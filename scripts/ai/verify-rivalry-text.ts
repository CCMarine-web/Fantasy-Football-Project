import "../lib/load-env";
import { prisma } from "@/lib/db";

/**
 * Checks that every AI rivalry summary agrees with the numbers displayed
 * beside it.
 *
 *   npx tsx scripts/ai/verify-rivalry-text.ts
 *   npx tsx scripts/ai/verify-rivalry-text.ts --clear-mismatched
 *
 * The blurbs are written from a verified packet and invalidated by an input
 * hash, but a model can still round a number, flip which manager leads, or
 * inherit a stale figure if the hash logic ever regressed. This reads each
 * stored summary back and cross-examines it against the record it is printed
 * next to.
 *
 * What it checks:
 *  - Series records quoted as "12-9" match the real head-to-head, either way round.
 *  - Any "N meetings" claim matches gamesPlayed.
 *  - Playoff and title-game counts are not overstated.
 *  - Streak claims name a manager who actually holds the streak.
 *  - Every other integer in the text corresponds to some real figure for the pair.
 *
 * `--clear-mismatched` blanks the offending summaries so the page falls back to
 * an honest empty state; a later backfill run rewrites them.
 */

interface Finding {
  pair: string;
  problem: string;
  detail: string;
}

/** Numbers that are legitimately in the packet for a pairing. */
function allowedNumbers(r: {
  gamesPlayed: number;
  managerAWins: number;
  managerBWins: number;
  ties: number;
  managerAPoints: number;
  managerBPoints: number;
  averageMargin: number | null;
  playoffMeetings: number;
  championshipMeetings: number;
  closestGameMargin: number | null;
  closestGameSeason: number | null;
  largestBlowoutMargin: number | null;
  largestBlowoutSeason: number | null;
  currentStreakCount: number;
  longestStreakCount: number;
  lastMeetingSeason: number | null;
  lastMeetingWeek: number | null;
}): Set<number> {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return;
    out.add(Math.round(n));
    out.add(Math.floor(n));
    out.add(Math.ceil(n));
  };
  add(r.gamesPlayed);
  add(r.managerAWins);
  add(r.managerBWins);
  add(r.ties);
  add(r.managerAPoints);
  add(r.managerBPoints);
  add(r.averageMargin);
  add(r.playoffMeetings);
  add(r.championshipMeetings);
  add(r.closestGameMargin);
  add(r.closestGameSeason);
  add(r.largestBlowoutMargin);
  add(r.largestBlowoutSeason);
  add(r.currentStreakCount);
  add(r.longestStreakCount);
  add(r.lastMeetingSeason);
  add(r.lastMeetingWeek);
  // "carrying the streak into the 2026 season" is a legitimate forward
  // reference, not a claim that a 2026 meeting happened.
  if (r.lastMeetingSeason != null) add(r.lastMeetingSeason + 1);
  // Per-manager averages are shown on the card too.
  if (r.gamesPlayed > 0) {
    add(r.managerAPoints / r.gamesPlayed);
    add(r.managerBPoints / r.gamesPlayed);
  }
  return out;
}

async function main() {
  const clear = process.argv.includes("--clear-mismatched");

  const rivalries = await prisma.rivalry.findMany({
    where: { summary: { not: null }, summaryIsMock: false },
    select: {
      id: true,
      summary: true,
      gamesPlayed: true,
      managerAWins: true,
      managerBWins: true,
      ties: true,
      managerAPoints: true,
      managerBPoints: true,
      averageMargin: true,
      playoffMeetings: true,
      championshipMeetings: true,
      closestGameMargin: true,
      closestGameSeason: true,
      largestBlowoutMargin: true,
      largestBlowoutSeason: true,
      currentStreakManagerId: true,
      currentStreakCount: true,
      longestStreakManagerId: true,
      longestStreakCount: true,
      lastMeetingSeason: true,
      lastMeetingWeek: true,
      managerA: { select: { id: true, displayName: true } },
      managerB: { select: { id: true, displayName: true } },
    },
  });

  console.log(
    `=== rivalry text verification ===\nchecking ${rivalries.length} summary/summaries\n`,
  );
  const findings: Finding[] = [];

  for (const r of rivalries) {
    const pair = `${r.managerA.displayName} vs ${r.managerB.displayName}`;
    const text = r.summary ?? "";
    const allowed = allowedNumbers(r);

    // 1. Series records quoted as "12-9" / "12-9-1".
    for (const match of text.matchAll(
      /\b(\d{1,2})\s*[-–]\s*(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\b/g,
    )) {
      const [, aRaw, bRaw, tRaw] = match;
      const a = Number(aRaw);
      const b = Number(bRaw);
      const t = tRaw ? Number(tRaw) : 0;
      const forward = a === r.managerAWins && b === r.managerBWins && t === r.ties;
      const reversed = a === r.managerBWins && b === r.managerAWins && t === r.ties;
      // A score line like "128-115" is not a record; only flag plausible records.
      const looksLikeRecord = a + b + t <= r.gamesPlayed + 2 && a <= 30 && b <= 30;
      if (looksLikeRecord && !forward && !reversed) {
        findings.push({
          pair,
          problem: "record mismatch",
          detail: `text says "${match[0]}" but the series is ${r.managerAWins}-${r.managerBWins}${r.ties ? `-${r.ties}` : ""}`,
        });
      }
    }

    // 2. "N meetings" / "N games".
    for (const match of text.matchAll(/\b(\d{1,3})\s+(meetings|games|matchups)\b/gi)) {
      if (Number(match[1]) !== r.gamesPlayed) {
        findings.push({
          pair,
          problem: "meeting count",
          detail: `text says "${match[0]}" but they have met ${r.gamesPlayed} times`,
        });
      }
    }

    // 3. Playoff / title-game counts must not be overstated.
    for (const match of text.matchAll(/\b(\d{1,2})\s+playoff\b/gi)) {
      if (Number(match[1]) > r.playoffMeetings) {
        findings.push({
          pair,
          problem: "playoff count",
          detail: `text says "${match[0]}" but there have been ${r.playoffMeetings}`,
        });
      }
    }
    // A summary may legitimately say they have NEVER met in a title game, so a
    // bare keyword match is not enough — only flag an affirmative claim.
    if (r.championshipMeetings === 0) {
      for (const sentence of text.split(/(?<=[.!?])\s+/)) {
        if (!/\b(title game|championship game|for the title|in the final)\b/i.test(sentence))
          continue;
        const negated =
          /\b(no|not|never|neither|nor|yet to|without|haven'?t|hasn'?t|hadn'?t|didn'?t|don'?t|doesn'?t|awaits?|still waiting)\b/i.test(
            sentence,
          );
        if (!negated) {
          findings.push({
            pair,
            problem: "title game claimed",
            detail: `"${sentence.trim().slice(0, 120)}" asserts a title-game meeting but there have been none`,
          });
        }
      }
    }

    // 4. Streak claims must name whoever actually holds the streak.
    const streakHolder =
      r.currentStreakManagerId === r.managerA.id
        ? r.managerA.displayName
        : r.currentStreakManagerId === r.managerB.id
          ? r.managerB.displayName
          : null;
    if (/\bstreak\b/i.test(text) && r.currentStreakCount > 0 && streakHolder) {
      const other =
        streakHolder === r.managerA.displayName ? r.managerB.displayName : r.managerA.displayName;
      // The copy refers to people by first name as often as by surname
      // ("Patrick is on a two-meeting streak"), so match on either part.
      const parts = (name: string) => name.split(/\s+/).filter((p) => p.length > 2);
      const mentions = (sentence: string, name: string) =>
        parts(name).some((part) => new RegExp(`\\b${part}\\b`, "i").test(sentence));

      const streakSentence = text.split(/(?<=[.!?])\s+/).find((s) => /\bstreak\b/i.test(s));
      if (
        streakSentence &&
        mentions(streakSentence, other) &&
        !mentions(streakSentence, streakHolder)
      ) {
        findings.push({
          pair,
          problem: "streak attributed to the wrong manager",
          detail: `${streakHolder} holds the current streak (${r.currentStreakCount}) but the streak sentence names only ${other}`,
        });
      }
    }

    // 5. Any other integer should correspond to something real.
    //
    // Numbers are matched WITH their thousands separators: a bare \b\d+\b
    // pattern splits "2,237" into "2" and "237" and then reports the phantom
    // 237 as unsupported.
    for (const match of text.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\b/g)) {
      const n = Number(match[1].replace(/,/g, ""));
      // Skip small numbers used as ordinary prose ("a third time", "two of three").
      if (n <= 3) continue;
      if (allowed.has(n)) continue;
      // Differences the reader can do in their head from two displayed figures
      // (e.g. "a 230-point edge" from 1,982 minus 1,752) are fair game, and can
      // be off by one from the unrounded values.
      const derived = Math.abs(Math.round(r.managerAPoints) - Math.round(r.managerBPoints));
      if (Math.abs(n - derived) <= 1) continue;
      findings.push({
        pair,
        problem: "unsupported number",
        detail: `text contains ${match[0]}, which matches no figure on record for this pairing`,
      });
    }
  }

  if (findings.length === 0) {
    console.log("No contradictions found — every summary agrees with its displayed record.");
    return;
  }

  const byPair = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byPair.get(f.pair) ?? [];
    list.push(f);
    byPair.set(f.pair, list);
  }

  console.log(`${findings.length} issue(s) across ${byPair.size} pairing(s):\n`);
  for (const [pair, list] of byPair) {
    console.log(`  ${pair}`);
    for (const f of list) console.log(`      [${f.problem}] ${f.detail}`);
  }

  if (clear) {
    const ids = rivalries
      .filter((r) => byPair.has(`${r.managerA.displayName} vs ${r.managerB.displayName}`))
      .map((r) => r.id);
    // Clearing the hash too, so the next backfill rewrites rather than skipping.
    const { count } = await prisma.rivalry.updateMany({
      where: { id: { in: ids } },
      data: { summary: null, summaryInputHash: null },
    });
    console.log(
      `\nCleared ${count} summary/summaries. Re-run scripts/ai/backfill-blurbs.ts --kind rivalry to rewrite.`,
    );
  } else {
    console.log("\nRe-run with --clear-mismatched to blank these and regenerate.");
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
