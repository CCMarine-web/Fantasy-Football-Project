import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getSleeperProvider } from "@/server/sleeper/provider";

/**
 * Records each starter's real lineup slot (FLEX included) for every final
 * week of every Sleeper season.
 *
 * Until Oct 2026 the sync stored a starter's slot as the player's position, so
 * which starters filled the FLEX spots was lost — and "best possible lineup"
 * maths (lineup efficiency, Bench Blunder, the Hall of Shame bench record)
 * could not be done legally. Sleeper lists a week's starters in the league's
 * roster_positions order, so the slots are recoverable. Only lineupSlot on
 * starter rows is written; scores and everything else are untouched.
 *
 *   npx tsx scripts/import/backfill-starter-slots.ts            # every Sleeper season
 *   npx tsx scripts/import/backfill-starter-slots.ts --years 2025
 */
async function main() {
  const i = process.argv.indexOf("--years");
  const years = i >= 0 ? process.argv[i + 1].split(",").map(Number) : null;
  const provider = getSleeperProvider();
  const seasons = await prisma.season.findMany({
    where: { dataSource: "SLEEPER", sleeperLeagueId: { not: null }, ...(years ? { year: { in: years } } : {}) },
    select: { id: true, year: true, sleeperLeagueId: true },
    orderBy: { year: "asc" },
  });

  for (const season of seasons) {
    const league = await provider.getLeague(season.sleeperLeagueId!);
    const slots = (league.roster_positions ?? []).filter((p) => !["BN", "IR", "TAXI"].includes(p));
    const teams = await prisma.fantasyTeam.findMany({ where: { seasonId: season.id }, select: { id: true, sleeperRosterId: true } });
    const teamByRoster = new Map(teams.map((t) => [t.sleeperRosterId, t.id]));
    const weeks = await prisma.roster.findMany({
      where: { fantasyTeam: { seasonId: season.id } },
      distinct: ["week"],
      select: { week: true },
      orderBy: { week: "asc" },
    });
    let updated = 0;
    for (const { week } of weeks) {
      const matchups = await provider.getMatchups(season.sleeperLeagueId!, week);
      for (const m of matchups) {
        const fantasyTeamId = teamByRoster.get(String(m.roster_id));
        if (!fantasyTeamId) continue;
        const roster = await prisma.roster.findUnique({ where: { fantasyTeamId_week: { fantasyTeamId, week } }, select: { id: true } });
        if (!roster) continue;
        // Group this roster's starters by slot, one update per slot.
        const bySlot = new Map<string, string[]>();
        (m.starters ?? []).forEach((sleeperPid, idx) => {
          const slot = slots[idx];
          if (!slot || !sleeperPid || sleeperPid === "0") return;
          bySlot.set(slot, [...(bySlot.get(slot) ?? []), sleeperPid]);
        });
        for (const [slot, sleeperIds] of bySlot) {
          const r = await prisma.weeklyPlayerScore.updateMany({
            where: { rosterId: roster.id, isStarter: true, player: { sleeperPlayerId: { in: sleeperIds } } },
            data: { lineupSlot: slot },
          });
          updated += r.count;
        }
      }
    }
    console.log(`${season.year}: ${weeks.length} weeks, ${updated} starter slots recorded (${slots.join(",")})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
