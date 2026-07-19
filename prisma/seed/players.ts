import crypto from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Rng } from "./rng";
import {
  FIRST_NAMES,
  LAST_NAMES,
  NFL_CITY_NAMES,
  NFL_TEAMS,
  POSITION_COUNTS,
} from "./constants";
import type { PlayerSeed, Position } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

/** Generates a fictional (~180-row) player pool, one DEF per NFL team. */
export function generatePlayerPool(rng: Rng): PlayerSeed[] {
  const players: PlayerSeed[] = [];
  const usedNames = new Set<string>();

  function uniqueName(): { firstName: string; lastName: string } {
    for (let attempt = 0; attempt < 500; attempt++) {
      const firstName = rng.pick(FIRST_NAMES);
      const lastName = rng.pick(LAST_NAMES);
      const key = `${firstName} ${lastName}`;
      if (!usedNames.has(key)) {
        usedNames.add(key);
        return { firstName, lastName };
      }
    }
    // Fallback: append a numeric suffix so we never fail to produce a row.
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = `${rng.pick(LAST_NAMES)}-${usedNames.size}`;
    usedNames.add(`${firstName} ${lastName}`);
    return { firstName, lastName };
  }

  const skillPositions: Position[] = ["QB", "RB", "WR", "TE", "K"];
  for (const position of skillPositions) {
    const count = POSITION_COUNTS[position];
    for (let i = 0; i < count; i++) {
      const { firstName, lastName } = uniqueName();
      const nflTeam = rng.pick(NFL_TEAMS);
      players.push({ firstName, lastName, position, nflTeam });
    }
  }

  // DEF: one per NFL team, named "<City> Defense" — repeat to hit the pool
  // target count if POSITION_COUNTS.DEF exceeds 32 (it does not currently).
  const defCount = POSITION_COUNTS.DEF;
  for (let i = 0; i < defCount; i++) {
    const nflTeam = NFL_TEAMS[i % NFL_TEAMS.length]!;
    players.push({
      firstName: NFL_CITY_NAMES[nflTeam]!,
      lastName: "Defense",
      position: "DEF",
      nflTeam,
    });
  }

  return players;
}

/** Persists the generated player pool and returns player ids grouped by position. */
export async function persistPlayerPool(
  prisma: PrismaClient,
  players: PlayerSeed[],
): Promise<Record<Position, string[]>> {
  const rows = players.map((p) => ({ id: newId(), ...p }));
  await prisma.fantasyPlayer.createMany({
    data: rows.map((r) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      position: r.position,
      nflTeam: r.nflTeam,
      status: "ACTIVE",
    })),
  });

  const byPosition: Record<Position, string[]> = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] };
  for (const r of rows) {
    byPosition[r.position].push(r.id);
  }
  return byPosition;
}
