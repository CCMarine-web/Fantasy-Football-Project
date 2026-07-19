import crypto from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  FOUNDED_YEAR,
  LEAGUE_NAME,
  LEAGUE_SHORT_NAME,
  MANAGERS,
  SENSITIVE_TOPICS,
  teamNameForSeason,
} from "./constants";
import type { ManagerKey } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

export async function seedLeague(prisma: PrismaClient): Promise<string> {
  const league = await prisma.league.create({
    data: {
      name: LEAGUE_NAME,
      shortName: LEAGUE_SHORT_NAME,
      foundedYear: FOUNDED_YEAR,
      description:
        "A private 12-manager dynasty of rivalries, questionable waiver bids, and one very online group chat.",
      defaultHumorLevel: 3,
      sensitiveTopics: SENSITIVE_TOPICS,
    },
  });
  return league.id;
}

export async function seedManagers(prisma: PrismaClient): Promise<Record<ManagerKey, string>> {
  const managerIdByKey = {} as Record<ManagerKey, string>;

  for (const m of MANAGERS) {
    const id = newId();
    managerIdByKey[m.key] = id;
    await prisma.manager.create({
      data: {
        id,
        displayName: m.displayName,
        bio: m.bio,
        joinedYear: FOUNDED_YEAR,
        isActive: true,
        noRoast: m.noRoast,
      },
    });
  }

  // Tyler Brandt's team name changed twice — the only manager with real
  // TeamNameHistory entries (everyone else keeps one name for their career).
  await prisma.teamNameHistory.createMany({
    data: [
      { managerId: managerIdByKey.tyler!, name: teamNameForSeason("tyler", 2021), seasonYear: 2021 },
      { managerId: managerIdByKey.tyler!, name: teamNameForSeason("tyler", 2022), seasonYear: 2022 },
      { managerId: managerIdByKey.tyler!, name: teamNameForSeason("tyler", 2024), seasonYear: 2024 },
    ],
  });

  return managerIdByKey;
}
