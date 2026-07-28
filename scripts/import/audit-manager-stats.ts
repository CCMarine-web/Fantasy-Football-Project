import "../lib/load-env";
import { prisma } from "@/lib/db";

/**
 * Audits every manager's season-by-season record against the underlying game
 * data, and reports anything that is missing, contradictory, or inconsistent
 * between the two platform eras.
 *
 *   npx tsx scripts/import/audit-manager-stats.ts
 *   npx tsx scripts/import/audit-manager-stats.ts --repair
 *
 * ── What it checks ────────────────────────────────────────────────────────
 *  1. Wins / losses / ties / points-for / points-against on each FantasyTeam
 *     match the regular-season MatchupTeam rows they are derived from.
 *  2. Every played season has a regular-season rank.
 *  3. Every completed season has a final placing.
 *  4. Ranks within a season are a clean 1..N with no gaps or duplicates.
 *  5. `isChampion` agrees with the Championship row, in both directions.
 *  6. Championship / runner-up / third all point at teams from that season.
 *  7. Career totals reconcile: the per-season rows sum to the career figures
 *     the manager pages display.
 *
 * `--repair` fixes only what is unambiguously derivable from game data
 * (aggregates and regular-season ranks). Anything requiring a judgement call is
 * reported, never guessed.
 */

interface Issue {
  scope: string;
  detail: string;
  repairable: boolean;
}

const issues: Issue[] = [];
const note = (scope: string, detail: string, repairable = false) =>
  issues.push({ scope, detail, repairable });

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  const repair = process.argv.includes("--repair");
  console.log(`=== manager statistics audit ===${repair ? " (REPAIR)" : " (report only)"}`);

  const seasons = await prisma.season.findMany({
    orderBy: { year: "asc" },
    select: {
      id: true,
      year: true,
      dataSource: true,
      status: true,
      fantasyTeams: {
        select: {
          id: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          pointsAgainst: true,
          regularSeasonRank: true,
          finalRank: true,
          madePlayoffs: true,
          isChampion: true,
          manager: { select: { id: true, displayName: true } },
        },
      },
      championship: {
        select: {
          championFantasyTeamId: true,
          championManagerId: true,
          runnerUpFantasyTeamId: true,
          thirdPlaceFantasyTeamId: true,
        },
      },
    },
  });

  let repaired = 0;

  for (const season of seasons) {
    const label = `${season.year} (${season.dataSource})`;
    const played = season.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0);
    if (played.length === 0) {
      console.log(`  ${label}: not played yet — skipped`);
      continue;
    }

    // ── 1. Aggregates vs the games actually recorded ──────────────────────
    const matchupTeams = await prisma.matchupTeam.findMany({
      where: { matchup: { seasonId: season.id, isPlayoff: false }, score: { not: null } },
      select: {
        score: true,
        fantasyTeamId: true,
        matchup: { select: { teams: { select: { fantasyTeamId: true, score: true } } } },
      },
    });

    const derived = new Map<string, { w: number; l: number; t: number; pf: number; pa: number }>();
    for (const team of season.fantasyTeams)
      derived.set(team.id, { w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    for (const mt of matchupTeams) {
      if (mt.score == null) continue;
      const opponent = mt.matchup.teams.find((x) => x.fantasyTeamId !== mt.fantasyTeamId);
      if (!opponent || opponent.score == null) continue;
      const agg = derived.get(mt.fantasyTeamId);
      if (!agg) continue;
      agg.pf += mt.score;
      agg.pa += opponent.score;
      if (mt.score > opponent.score) agg.w += 1;
      else if (mt.score < opponent.score) agg.l += 1;
      else agg.t += 1;
    }

    for (const team of played) {
      const d = derived.get(team.id);
      if (!d) continue;
      const mismatches: string[] = [];
      if (d.w !== team.wins || d.l !== team.losses || d.t !== team.ties) {
        mismatches.push(
          `record stored ${team.wins}-${team.losses}-${team.ties} but games give ${d.w}-${d.l}-${d.t}`,
        );
      }
      if (Math.abs(round(d.pf) - round(team.pointsFor)) > 0.5) {
        mismatches.push(`PF stored ${round(team.pointsFor)} but games give ${round(d.pf)}`);
      }
      if (Math.abs(round(d.pa) - round(team.pointsAgainst)) > 0.5) {
        mismatches.push(`PA stored ${round(team.pointsAgainst)} but games give ${round(d.pa)}`);
      }
      for (const m of mismatches) {
        note(`${label} ${team.manager.displayName}`, m, true);
        if (repair) {
          await prisma.fantasyTeam.update({
            where: { id: team.id },
            data: {
              wins: d.w,
              losses: d.l,
              ties: d.t,
              pointsFor: round(d.pf),
              pointsAgainst: round(d.pa),
            },
          });
          repaired++;
        }
      }
    }

    // ── 2/4. Regular-season ranks present, and a clean 1..N ───────────────
    const missingReg = played.filter((t) => t.regularSeasonRank == null);
    for (const team of missingReg) {
      note(`${label} ${team.manager.displayName}`, "no regular-season rank", true);
    }
    if (repair && missingReg.length > 0) {
      const ordered = [...played].sort((a, b) => {
        const ag = a.wins + a.losses + a.ties;
        const bg = b.wins + b.losses + b.ties;
        const apct = ag ? (a.wins + a.ties * 0.5) / ag : 0;
        const bpct = bg ? (b.wins + b.ties * 0.5) / bg : 0;
        return bpct - apct || b.pointsFor - a.pointsFor;
      });
      for (const [i, team] of ordered.entries()) {
        await prisma.fantasyTeam.update({
          where: { id: team.id },
          data: { regularSeasonRank: i + 1 },
        });
        repaired++;
      }
    }

    const regRanks = played
      .map((t) => t.regularSeasonRank)
      .filter((r): r is number => r != null)
      .sort((a, b) => a - b);
    if (regRanks.length === played.length) {
      const expected = Array.from({ length: played.length }, (_, i) => i + 1);
      if (JSON.stringify(regRanks) !== JSON.stringify(expected)) {
        note(
          label,
          `regular-season ranks are not a clean 1..${played.length}: [${regRanks.join(", ")}]`,
        );
      }
    }

    // ── 3. Final placings on a completed season ───────────────────────────
    if (season.status === "COMPLETE") {
      const missingFinal = played.filter((t) => t.finalRank == null);
      for (const team of missingFinal) {
        note(
          `${label} ${team.manager.displayName}`,
          "no final placing on a completed season (run scripts/import/backfill-final-placements.ts)",
        );
      }
      const finalRanks = played
        .map((t) => t.finalRank)
        .filter((r): r is number => r != null)
        .sort((a, b) => a - b);
      if (finalRanks.length === played.length) {
        const expected = Array.from({ length: played.length }, (_, i) => i + 1);
        if (JSON.stringify(finalRanks) !== JSON.stringify(expected)) {
          note(
            label,
            `final placings are not a clean 1..${played.length}: [${finalRanks.join(", ")}]`,
          );
        }
      }
    }

    // ── 5/6. Championship consistency ─────────────────────────────────────
    const flagged = played.filter((t) => t.isChampion);
    if (season.championship) {
      const championTeam = played.find((t) => t.id === season.championship!.championFantasyTeamId);
      if (!championTeam) {
        note(label, "championship row points at a team that is not in this season");
      } else {
        if (!championTeam.isChampion) {
          note(
            `${label} ${championTeam.manager.displayName}`,
            "is the recorded champion but isChampion is false",
            true,
          );
          if (repair) {
            await prisma.fantasyTeam.update({
              where: { id: championTeam.id },
              data: { isChampion: true },
            });
            repaired++;
          }
        }
        if (championTeam.manager.id !== season.championship.championManagerId) {
          note(label, "championship championManagerId does not match the champion team's manager");
        }
        if (championTeam.finalRank != null && championTeam.finalRank !== 1) {
          note(
            label,
            `champion ${championTeam.manager.displayName} has final placing #${championTeam.finalRank}, not #1`,
          );
        }
      }
      for (const extra of flagged.filter(
        (t) => t.id !== season.championship!.championFantasyTeamId,
      )) {
        note(
          `${label} ${extra.manager.displayName}`,
          "isChampion is true but they are not the recorded champion",
          true,
        );
        if (repair) {
          await prisma.fantasyTeam.update({ where: { id: extra.id }, data: { isChampion: false } });
          repaired++;
        }
      }
      for (const [role, id] of [
        ["runner-up", season.championship.runnerUpFantasyTeamId],
        ["third place", season.championship.thirdPlaceFantasyTeamId],
      ] as const) {
        if (id && !played.some((t) => t.id === id)) {
          note(label, `${role} points at a team that is not in this season`);
        }
      }
    } else if (season.status === "COMPLETE") {
      note(label, "completed season with no championship recorded");
      for (const t of flagged) {
        note(
          `${label} ${t.manager.displayName}`,
          "isChampion is true but the season has no championship row",
        );
      }
    }
  }

  // ── 7. Career totals reconcile with the per-season rows ─────────────────
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      displayName: true,
      fantasyTeams: {
        select: {
          wins: true,
          losses: true,
          ties: true,
          isChampion: true,
          season: { select: { year: true } },
        },
      },
      championships: { select: { id: true } },
    },
    orderBy: { displayName: "asc" },
  });

  console.log("\n  career reconciliation:");
  for (const manager of managers) {
    const played = manager.fantasyTeams.filter((t) => t.wins + t.losses + t.ties > 0);
    const w = played.reduce((s, t) => s + t.wins, 0);
    const l = played.reduce((s, t) => s + t.losses, 0);
    const t = played.reduce((s, x) => s + x.ties, 0);
    const flaggedTitles = played.filter((x) => x.isChampion).length;
    const recordedTitles = manager.championships.length;
    if (flaggedTitles !== recordedTitles) {
      note(
        manager.displayName,
        `${flaggedTitles} season(s) flagged champion but ${recordedTitles} Championship row(s) exist`,
      );
    }
    const years = played.map((x) => x.season.year).sort((a, b) => a - b);
    console.log(
      `    ${manager.displayName.padEnd(20)} ${played.length} seasons ${years[0]}-${years.at(-1)}  ${w}-${l}${t ? `-${t}` : ""}  titles=${recordedTitles}`,
    );
  }

  console.log(`\n=== result ===`);
  if (repair) console.log(`repaired ${repaired} field(s)`);
  if (issues.length === 0) {
    console.log("No discrepancies found.");
    return;
  }
  const repairable = issues.filter((i) => i.repairable).length;
  console.log(`${issues.length} issue(s) (${repairable} auto-repairable):`);
  for (const issue of issues) {
    console.log(`  [${issue.repairable ? "FIXABLE" : "REVIEW "}] ${issue.scope}: ${issue.detail}`);
  }
  if (!repair && repairable > 0) console.log("\nRe-run with --repair to fix the FIXABLE ones.");
  process.exitCode = issues.length > 0 && !repair ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
