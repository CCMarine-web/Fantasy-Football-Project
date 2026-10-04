import "dotenv/config";
import { prisma } from "@/lib/db";
import { SeasonStatus } from "@/generated/prisma/client";
import {
  CURRENT_SEASON_WEEKS_PLAYED,
  REGULAR_SEASON_WEEKS,
  SEASON_YEARS,
  TEAM_COUNT,
} from "./seed/constants";
import { clearDatabase } from "./seed/clear";
import { seedLeague, seedManagers } from "./seed/managers";
import { generatePlayerPool, persistPlayerPool } from "./seed/players";
import { Rng } from "./seed/rng";
import { simulateSeason } from "./seed/season";
import { seedSeasonTransactions } from "./seed/transactions";
import { seedUsers } from "./seed/users";
import { computeRivalries } from "./seed/rivalries";
import { computeLeagueRecords } from "./seed/records";
import { seedContent } from "./seed/content";
import { seedChatSample } from "./seed/chat";
import type { ManagerKey } from "./seed/types";
import type { FinalStandingRow } from "./seed/types";

const CHAMPION_BY_YEAR: Partial<Record<number, ManagerKey>> = {
  2021: "sofia",
  2022: "marcus",
  2023: "sofia",
  2024: "deshawn",
};

function draftOrderFromStandings(prevFinal: FinalStandingRow[] | null): number[] {
  if (!prevFinal) return Array.from({ length: TEAM_COUNT }, (_, i) => i);
  // Worst regular-season finish picks first (traditional snake-draft order).
  return [...prevFinal].sort((a, b) => b.regularSeasonRank - a.regularSeasonRank).map((r) => r.teamIndex);
}

/**
 * The seed DELETES EVERYTHING and replaces it with a fictional league. Pointed
 * at the real database it would destroy the league's history, so it refuses
 * whenever real league data is present — a season linked to a real Sleeper
 * league or imported from ESPN — unless SEED_WIPE_REAL_DATA says otherwise.
 */
async function assertSafeToSeed(): Promise<void> {
  if (process.env.SEED_WIPE_REAL_DATA === "yes-delete-everything") return;
  const real = await prisma.season.count({
    // The seed never sets a Sleeper or ESPN id, so either one means real data.
    where: { OR: [{ espnLeagueId: { not: null } }, { dataSource: "ESPN" }, { sleeperLeagueId: { not: null } }] },
  });
  if (real > 0) {
    throw new Error(
      `Refusing to seed: this database holds ${real} real season(s) (Sleeper/ESPN). ` +
        "The seed wipes every table. Point DATABASE_URL at a local or throwaway database instead.",
    );
  }
}

async function main(): Promise<void> {
  await assertSafeToSeed();
  console.log("Clearing existing data...");
  await clearDatabase(prisma);

  console.log("Seeding league and managers...");
  const leagueId = await seedLeague(prisma);
  const managerIdByKey = await seedManagers(prisma);

  const rng = new Rng();
  const playerPool = generatePlayerPool(rng);
  const playerIdsByPosition = await persistPlayerPool(prisma, playerPool);
  const allPlayerIds = Object.values(playerIdsByPosition).flat();

  const seasonIdByYear: Record<number, string> = {};
  let previousFinalStandings: FinalStandingRow[] | null = null;

  for (const year of SEASON_YEARS) {
    const isCurrent = year === 2025;
    const status = isCurrent ? SeasonStatus.IN_PROGRESS : SeasonStatus.COMPLETE;
    const weeksToPlay = isCurrent ? CURRENT_SEASON_WEEKS_PLAYED : REGULAR_SEASON_WEEKS;
    const simulatePlayoffs = !isCurrent;
    const prescribedChampionKey = CHAMPION_BY_YEAR[year];

    console.log(`Simulating ${year} season...`);
    const result = await simulateSeason({
      prisma,
      rng,
      leagueId,
      year,
      status,
      isCurrent,
      weeksToPlay,
      simulatePlayoffs,
      managerIdByKey,
      playerIdsByPosition,
      draftOrderTeamIndices: draftOrderFromStandings(previousFinalStandings),
      prescribedChampionKey,
    });

    seasonIdByYear[year] = result.seasonId;
    previousFinalStandings = result.finalStandings;

    const draftedThisSeason = new Set(Object.values(result.draftedPlayerIdsByManagerKey).flat());
    const freeAgentPlayerIds = allPlayerIds.filter((id) => !draftedThisSeason.has(id));

    if (result.championKey) {
      await prisma.championship.create({
        data: {
          seasonId: result.seasonId,
          championFantasyTeamId: result.fantasyTeamIdByManagerKey[result.championKey],
          championManagerId: managerIdByKey[result.championKey],
          runnerUpFantasyTeamId: result.runnerUpKey ? result.fantasyTeamIdByManagerKey[result.runnerUpKey] : null,
          thirdPlaceFantasyTeamId: result.thirdKey ? result.fantasyTeamIdByManagerKey[result.thirdKey] : null,
        },
      });
    }

    const forcedNotableTrades =
      year === 2022
        ? [
            {
              managerA: "deshawn" as ManagerKey,
              managerB: "aisha" as ManagerKey,
              notes: "Sent a throw-in mid-round pick disguised as filler; it became a league-altering heist by season's end.",
            },
          ]
        : year === 2024
          ? [
              {
                managerA: "brianna" as ManagerKey,
                managerB: "natalie" as ManagerKey,
                notes: "A three-for-two headline swap that Natalie is still explaining to the group chat.",
              },
            ]
          : [];

    await seedSeasonTransactions({
      prisma,
      rng,
      seasonId: result.seasonId,
      year,
      weeksPlayed: weeksToPlay,
      fantasyTeamIdByManagerKey: result.fantasyTeamIdByManagerKey,
      managerIdByKey,
      draftedPlayerIdsByManagerKey: result.draftedPlayerIdsByManagerKey,
      freeAgentPlayerIds,
      forcedNotableTrades,
      forcedRivalryTrade: year === 2023 ? { managerA: "sofia", managerB: "marcus" } : undefined,
      transactionCount: 20,
    });

    console.log(
      `Seeded ${year}: champion ${result.championKey ?? "(in progress)"}${
        result.championKey ? ` (${result.championKey})` : ""
      }`,
    );
  }

  console.log("Computing rivalries...");
  await computeRivalries(prisma);

  console.log("Computing league records...");
  await computeLeagueRecords(prisma);

  console.log("Seeding sample articles, quotes, and awards...");
  await seedContent({ prisma, managerIdByKey, seasonIdByYear });

  console.log("Seeding demo users...");
  const credentials = await seedUsers(prisma, managerIdByKey);

  console.log("Seeding sample chat-lore import...");
  const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: credentials[0]!.email } });
  await seedChatSample({ prisma, adminUserId: adminUser.id, managerIdByKey });

  console.log("\nDone. Demo login credentials:");
  for (const c of credentials) {
    console.log(`  ${c.label}: ${c.email} / ${c.password}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
