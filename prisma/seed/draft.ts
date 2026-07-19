import { DRAFT_ROUND_POSITIONS } from "./constants";
import type { Rng } from "./rng";
import type { Position } from "./types";

export interface DraftPickPlan {
  round: number;
  pickNumber: number;
  draftSlot: number;
  teamIndex: number;
  playerId: string;
  position: Position;
  isKeeper: boolean;
}

/**
 * Builds a full 16-round snake draft for one season. `teamOrder` is the
 * round-1 pick order (team indices, worst-to-first is traditional); it
 * reverses every even round. Each round drafts a fixed position (see
 * DRAFT_ROUND_POSITIONS) and consumes players from that position's shuffled
 * pool, so no player is picked twice within the same season.
 */
export function buildDraftPlan(
  rng: Rng,
  teamOrder: number[],
  playerIdsByPosition: Record<Position, string[]>,
): DraftPickPlan[] {
  const teamCount = teamOrder.length;
  const pools: Record<Position, string[]> = {
    QB: rng.shuffle(playerIdsByPosition.QB),
    RB: rng.shuffle(playerIdsByPosition.RB),
    WR: rng.shuffle(playerIdsByPosition.WR),
    TE: rng.shuffle(playerIdsByPosition.TE),
    K: rng.shuffle(playerIdsByPosition.K),
    DEF: rng.shuffle(playerIdsByPosition.DEF),
  };
  const cursor: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

  const picks: DraftPickPlan[] = [];
  let pickNumber = 0;

  for (let round = 1; round <= DRAFT_ROUND_POSITIONS.length; round++) {
    const position = DRAFT_ROUND_POSITIONS[round - 1]!;
    const order = round % 2 === 1 ? teamOrder : [...teamOrder].reverse();
    for (let slot = 0; slot < teamCount; slot++) {
      pickNumber++;
      const teamIndex = order[slot]!;
      const pool = pools[position];
      const idx = cursor[position]++;
      const playerId = pool[idx % pool.length]!;
      picks.push({
        round,
        pickNumber,
        draftSlot: slot + 1,
        teamIndex,
        playerId,
        position,
        isKeeper: false,
      });
    }
  }

  // Sprinkle in a handful of keepers: a few early/mid-round picks per season.
  const keeperCandidateIdx = rng.shuffle(picks.map((_, i) => i)).slice(0, 3);
  for (const i of keeperCandidateIdx) {
    picks[i]!.isKeeper = true;
  }

  return picks;
}
