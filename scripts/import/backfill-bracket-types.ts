import "../lib/load-env";
import { prisma } from "@/lib/db";
import type { SleeperBracketMatchup } from "@/server/sleeper/types";

/**
 * Labels every Sleeper playoff game as championship bracket or consolation.
 *
 *   npx tsx scripts/import/backfill-bracket-types.ts --dry-run
 *   npx tsx scripts/import/backfill-bracket-types.ts
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 * The ESPN importer records `bracketType` from ESPN's playoff tier, but the
 * Sleeper sync never did, so all 57 Sleeper postseason games sat untyped. That
 * made every record on the site quietly wrong in the same way: a toilet-bowl
 * game counted identically to a semifinal, so "playoff record" included games
 * played to avoid last place, and "regular season" was the only clean split.
 *
 * ── How a game is classified ──────────────────────────────────────────────
 * Sleeper publishes the two brackets as lists of matchups keyed by roster id.
 * Rather than trusting a week offset, each stored game is matched to a bracket
 * entry by its unordered pair of roster ids — a pair meets at most once in a
 * single-elimination bracket, so the mapping is exact. A pair that appears in
 * BOTH brackets, or in neither, is left untyped and reported: an unlabelled
 * game is honest, a mislabelled one corrupts every record derived from it.
 *
 * Round names come from the bracket's own `p` (placement) field where it has
 * one, so "Championship" and "Third-place game" are Sleeper's own designation
 * rather than an inference from the week number.
 */

const API = "https://api.sleeper.app/v1";

async function bracket(
  leagueId: string,
  kind: "winners_bracket" | "losers_bracket",
): Promise<SleeperBracketMatchup[]> {
  const res = await fetch(`${API}/league/${leagueId}/${kind}`);
  if (!res.ok) throw new Error(`Sleeper ${kind} for league ${leagueId}: HTTP ${res.status}`);
  return (await res.json()) as SleeperBracketMatchup[];
}

/*
 * Roster ids are numbers in the bracket payload but strings on FantasyTeam, and
 * comparing them as they arrive silently mismatched every pair containing
 * roster 10 — "10" sorts before "8". Both sides are coerced to numbers here.
 */
function pairKey(a: string | number, b: string | number): string {
  const x = Number(a);
  const y = Number(b);
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

/**
 * A human-readable name for a bracket game. `p` marks a game that decides a
 * specific placement; everything else is named by how many rounds remain.
 */
function roundNameFor(
  m: SleeperBracketMatchup,
  kind: "WINNERS" | "CONSOLATION",
  maxRound: number,
): string {
  if (kind === "WINNERS") {
    if (m.p === 1) return "Championship";
    if (m.p === 3) return "Third-place game";
    if (m.p === 5) return "Fifth-place game";
    if (m.r === maxRound) return "Championship";
    if (m.r === maxRound - 1) return "Semifinal";
    if (m.r === maxRound - 2) return "Quarterfinal";
    return `Playoff round ${m.r}`;
  }
  if (m.p != null) return "Consolation placement game";
  return "Consolation bracket";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`=== playoff bracket labelling ===${dryRun ? " (DRY RUN)" : ""}`);

  const seasons = await prisma.season.findMany({
    where: { dataSource: "SLEEPER", sleeperLeagueId: { not: null } },
    select: { id: true, year: true, sleeperLeagueId: true },
    orderBy: { year: "asc" },
  });

  let labelled = 0;
  const unresolved: string[] = [];

  for (const season of seasons) {
    const leagueId = season.sleeperLeagueId!;
    let winners: SleeperBracketMatchup[];
    let losers: SleeperBracketMatchup[];
    try {
      [winners, losers] = await Promise.all([
        bracket(leagueId, "winners_bracket"),
        bracket(leagueId, "losers_bracket"),
      ]);
    } catch (error) {
      console.log(`  ${season.year}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const maxWinnersRound = Math.max(0, ...winners.map((m) => m.r ?? 0));
    const maxLosersRound = Math.max(0, ...losers.map((m) => m.r ?? 0));

    const byPair = new Map<string, { kind: "WINNERS" | "CONSOLATION"; name: string; round: number }[]>();
    const index = (list: SleeperBracketMatchup[], kind: "WINNERS" | "CONSOLATION", maxRound: number) => {
      for (const m of list) {
        if (m.t1 == null || m.t2 == null) continue;
        const key = pairKey(m.t1, m.t2);
        const list2 = byPair.get(key) ?? [];
        list2.push({ kind, name: roundNameFor(m, kind, maxRound), round: m.r ?? 0 });
        byPair.set(key, list2);
      }
    };
    index(winners, "WINNERS", maxWinnersRound);
    index(losers, "CONSOLATION", maxLosersRound);

    const matchups = await prisma.matchup.findMany({
      where: { seasonId: season.id, isPlayoff: true },
      select: {
        id: true,
        week: true,
        bracketType: true,
        teams: { select: { fantasyTeam: { select: { sleeperRosterId: true } } } },
      },
      orderBy: { week: "asc" },
    });

    let seasonLabelled = 0;
    let byes = 0;
    for (const m of matchups) {
      const rosters = m.teams
        .map((t) => t.fantasyTeam.sleeperRosterId)
        .filter((r): r is string => r != null);

      /*
       * Sleeper writes a one-sided row for a team that has no postseason
       * opponent that week — a first-round bye, or an eliminated team still
       * being scored. It is not a game and cannot win or lose one, so it is
       * counted separately rather than reported as a failure.
       */
      if (rosters.length !== 2) {
        byes++;
        continue;
      }

      const hits = byPair.get(pairKey(rosters[0], rosters[1])) ?? [];
      const kinds = new Set(hits.map((h) => h.kind));
      if (kinds.size > 1) {
        unresolved.push(
          `${season.year} week ${m.week}: rosters ${rosters.join(" v ")} appear in both brackets`,
        );
        continue;
      }

      /*
       * A postseason game that is in the winners bracket is a championship
       * game. Anything else played in the postseason is consolation — that
       * covers the toilet bowl proper and the extra placement games Sleeper
       * schedules outside either published bracket, both of which decide
       * nothing about the title.
       */
      const hit = [...hits].sort((a, b) => b.round - a.round)[0];
      const kind = hit?.kind ?? "CONSOLATION";
      const name = hit?.name ?? "Consolation bracket";

      if (!dryRun) {
        await prisma.matchup.update({
          where: { id: m.id },
          data: { bracketType: kind, roundName: name },
        });
      }
      seasonLabelled++;
      labelled++;
    }
    console.log(
      `  ${season.year}: ${seasonLabelled}/${matchups.length} playoff games labelled (${byes} one-sided row(s) left untyped)`,
    );
  }

  const stillUntyped = await prisma.matchup.count({
    where: { isPlayoff: true, bracketType: null },
  });

  console.log(`\n=== result ===`);
  console.log(`${labelled} game(s) labelled; ${stillUntyped} playoff game(s) remain untyped`);
  if (unresolved.length > 0) {
    console.log(`\nunresolved (${unresolved.length}):`);
    for (const u of unresolved) console.log(`  ${u}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
