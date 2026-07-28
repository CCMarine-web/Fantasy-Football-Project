import "../lib/load-env";
import { prisma } from "@/lib/db";

/**
 * Finds scores that are probably not real football results, and classifies
 * them so the records pages can leave the unverifiable ones out.
 *
 *   npx tsx scripts/import/audit-suspect-scores.ts
 *   npx tsx scripts/import/audit-suspect-scores.ts --apply
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 * A 0.0 in the matchup table can mean five different things, and the records
 * pages currently treat all five as "lowest score of all time":
 *
 *   TRUE ZERO         A real week where a real lineup scored nothing. Almost
 *                     never happens, but it is a legitimate record if it did.
 *   ABANDONED TEAM    A manager who stopped setting a lineup. The score is
 *                     real but it is not a contest, and it flatters whoever
 *                     drew them.
 *   NOT PLAYED        A scheduled game that never happened — a future week, or
 *                     a season that ended early.
 *   MISSING SOURCE    The platform has no score for a game it says was played.
 *   IMPORT ARTIFACT   A row written with a default of zero because the
 *                     importer could not read the real value.
 *
 * ── How each is told apart ────────────────────────────────────────────────
 * Only recorded facts are used:
 *  - A game whose week is in the future for its season, or whose season is not
 *    COMPLETE and whose opponent also has no score, is NOT PLAYED.
 *  - A zero where the roster has player-level scores that sum above zero is an
 *    IMPORT ARTIFACT: the players scored, the team total did not record it.
 *  - A zero where the roster has player-level data summing to zero, or has no
 *    players at all, is an ABANDONED TEAM if the same manager also has zero or
 *    near-zero scores in adjacent weeks, and MISSING SOURCE otherwise.
 *  - Anything left over stays UNCLASSIFIED and is excluded from records, because
 *    "we cannot explain this number" is not the same as "this is the record".
 *
 * Nothing is deleted. `--apply` marks the row `verifiedScore = false`, which is
 * what the records and Hall of Shame queries filter on; the score itself stays
 * on the row so the admin views can still show it.
 */

/** Below this a score is treated as "did not field a team". */
const NEAR_ZERO = 25;

type Verdict =
  | "TRUE_ZERO"
  | "ABANDONED_TEAM"
  | "NOT_PLAYED"
  | "MISSING_SOURCE"
  | "IMPORT_ARTIFACT"
  | "UNCLASSIFIED";

interface Suspect {
  id: string;
  year: number;
  week: number;
  manager: string;
  score: number;
  opponentScore: number | null;
  verdict: Verdict;
  reason: string;
}

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`=== suspect score audit ===${apply ? " (APPLY)" : " (report only)"}`);

  const rows = await prisma.matchupTeam.findMany({
    where: { OR: [{ score: null }, { score: { lt: NEAR_ZERO } }] },
    select: {
      id: true,
      score: true,
      fantasyTeamId: true,
      fantasyTeam: { select: { manager: { select: { displayName: true } } } },
      matchup: {
        select: {
          week: true,
          status: true,
          season: { select: { id: true, year: true, status: true } },
          teams: { select: { fantasyTeamId: true, score: true } },
        },
      },
    },
    orderBy: [{ matchup: { season: { year: "asc" } } }, { matchup: { week: "asc" } }],
  });

  if (rows.length === 0) {
    console.log("No scores below the near-zero threshold and no missing scores. Nothing to audit.");
    return;
  }

  /*
   * Player-level totals for the same team-week, where they exist. Rows whose
   * `points` is null are roster membership without a score — ESPN's archived
   * seasons are like this — and must not be read as zeros, so a week made
   * entirely of nulls counts as having NO player data rather than as a week
   * where everybody scored nothing.
   */
  const playerTotals = new Map<string, { started: number; any: number }>();
  const hasPlayerData = new Set<string>();
  const weekly = await prisma.weeklyPlayerScore.findMany({
    where: { roster: { fantasyTeamId: { in: [...new Set(rows.map((r) => r.fantasyTeamId))] } } },
    select: {
      points: true,
      isStarter: true,
      roster: { select: { fantasyTeamId: true, week: true } },
    },
  });
  for (const w of weekly) {
    if (w.points == null) continue;
    const key = `${w.roster.fantasyTeamId}-${w.roster.week}`;
    const cur = playerTotals.get(key) ?? { started: 0, any: 0 };
    cur.any += w.points;
    if (w.isStarter) cur.started += w.points;
    playerTotals.set(key, cur);
    hasPlayerData.add(key);
  }

  // Every score a manager posted, to spot a run of abandoned weeks.
  const allScores = await prisma.matchupTeam.findMany({
    where: { fantasyTeamId: { in: [...new Set(rows.map((r) => r.fantasyTeamId))] } },
    select: { fantasyTeamId: true, score: true, matchup: { select: { week: true } } },
  });
  const byTeamWeek = new Map<string, number | null>();
  for (const s of allScores) byTeamWeek.set(`${s.fantasyTeamId}-${s.matchup.week}`, s.score);

  const suspects: Suspect[] = [];

  for (const row of rows) {
    const { matchup } = row;
    const season = matchup.season;
    const opponent = matchup.teams.find((t) => t.fantasyTeamId !== row.fantasyTeamId);
    const key = `${row.fantasyTeamId}-${matchup.week}`;
    const players = playerTotals.get(key);
    const score = row.score;

    let verdict: Verdict;
    let reason: string;

    if (
      season.status !== "COMPLETE" &&
      (score == null || score === 0) &&
      (opponent?.score == null || opponent.score === 0)
    ) {
      verdict = "NOT_PLAYED";
      reason = `${season.year} is ${season.status.toLowerCase()} and neither side has a score`;
    } else if (score == null) {
      verdict = "MISSING_SOURCE";
      reason = "the platform recorded no score for a game it lists as played";
    } else if (hasPlayerData.has(key) && players && players.started > 1) {
      verdict = "IMPORT_ARTIFACT";
      reason = `starters scored ${players.started.toFixed(1)} but the team total reads ${score.toFixed(1)}`;
    } else if (score === 0) {
      const neighbours = [matchup.week - 1, matchup.week + 1]
        .map((w) => byTeamWeek.get(`${row.fantasyTeamId}-${w}`))
        .filter((s): s is number => s != null);
      const alsoDead = neighbours.filter((s) => s < NEAR_ZERO).length;
      if (alsoDead > 0) {
        verdict = "ABANDONED_TEAM";
        reason = `scored zero with ${alsoDead} adjacent week(s) also under ${NEAR_ZERO} — a team that stopped setting a lineup`;
      } else if (hasPlayerData.has(key)) {
        verdict = "TRUE_ZERO";
        reason = "player-level data exists for this week and every starter scored nothing";
      } else {
        verdict = "MISSING_SOURCE";
        reason = "a zero with no player-level data behind it and normal scores either side";
      }
    } else {
      // A low but non-zero score with real players behind it is just a bad week.
      verdict = hasPlayerData.has(key) ? "TRUE_ZERO" : "UNCLASSIFIED";
      reason =
        verdict === "TRUE_ZERO"
          ? `low but genuine — ${score.toFixed(1)} with player-level data to back it`
          : `${score.toFixed(1)} with no player-level data to confirm it`;
    }

    suspects.push({
      id: row.id,
      year: season.year,
      week: matchup.week,
      manager: row.fantasyTeam.manager?.displayName ?? "—",
      score: score ?? 0,
      opponentScore: opponent?.score ?? null,
      verdict,
      reason,
    });
  }

  const byVerdict = new Map<Verdict, Suspect[]>();
  for (const s of suspects) {
    const list = byVerdict.get(s.verdict) ?? [];
    list.push(s);
    byVerdict.set(s.verdict, list);
  }

  console.log(`\n${suspects.length} score(s) at or below ${NEAR_ZERO}, or missing:\n`);
  for (const [verdict, list] of [...byVerdict].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${verdict} (${list.length})`);
    for (const s of list) {
      console.log(
        `      ${s.year} wk${String(s.week).padStart(2)} ${s.manager.padEnd(20)} ${s.score.toFixed(1).padStart(6)} vs ${s.opponentScore?.toFixed(1) ?? "—"}  — ${s.reason}`,
      );
    }
  }

  /*
   * A score counts toward records only when it is a real result of a real
   * contest. Everything else is preserved but flagged.
   */
  const VERIFIED: Verdict[] = ["TRUE_ZERO"];
  const unverified = suspects.filter((s) => !VERIFIED.includes(s.verdict));

  console.log(
    `\n${unverified.length} score(s) would be excluded from records and the Hall of Shame; ${suspects.length - unverified.length} stand as genuine results.`,
  );

  if (apply) {
    const ids = unverified.map((s) => s.id);
    if (ids.length > 0) {
      const { count } = await prisma.matchupTeam.updateMany({
        where: { id: { in: ids } },
        data: { verifiedScore: false },
      });
      console.log(`marked ${count} row(s) unverified`);
    }
    // Anything not in the suspect list is, by definition, a normal score.
    const { count: restored } = await prisma.matchupTeam.updateMany({
      where: { id: { notIn: unverified.map((s) => s.id) }, verifiedScore: false },
      data: { verifiedScore: true },
    });
    if (restored > 0) console.log(`restored ${restored} row(s) that are no longer suspect`);
  } else {
    console.log("\nRe-run with --apply to flag the excluded rows.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
