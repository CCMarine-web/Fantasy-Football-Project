import { computeLuckWins, rankLuckWins, type LuckWins } from "@/server/stats/luck-wins";
import { loadVerifiedGames } from "./verified-games";
import { cached, CACHE_TAGS } from "@/server/cache";

// ── Luck in wins (the site's one luck number; stats/luck-wins.ts) ────────────

export interface RankedLuck extends LuckWins {
  managerId: string;
  /** 1 = luckiest; teams level at the shown precision share a rank. */
  rank: number;
  /** How many teams share this rank (1 = nobody). */
  tied: number;
  of: number;
}

async function loadLuckWins(year?: number): Promise<[string, RankedLuck][]> {
  const rows = await loadVerifiedGames(year ? { year } : {});
  const luck = computeLuckWins(
    rows.map((r) => ({
      managerId: r.managerId,
      opponentManagerId: r.opponentManagerId,
      year: r.year,
      week: r.week,
      isPlayoff: r.isPlayoff,
      bracket: r.bracket,
      score: r.score,
      opponentScore: r.opponentScore,
      isWinner: r.isWinner,
    })),
  );
  const ranked = rankLuckWins([...luck.entries()].filter(([, l]) => l.games > 0).map(([managerId, l]) => ({ ...l, managerId })));
  return ranked.map((l) => [l.managerId, l]);
}

const careerLuckWinsCached = cached(() => loadLuckWins(), ["luck-wins-career-v2"], { tags: [CACHE_TAGS.league, CACHE_TAGS.managers] });

/** Career luck in wins for every manager, ranked. */
export async function getCareerLuckWins(): Promise<Map<string, RankedLuck>> {
  return new Map(await careerLuckWinsCached());
}

/** One season's luck in wins for every manager who played in it, ranked. */
export async function getSeasonLuckWins(year: number): Promise<Map<string, RankedLuck>> {
  return new Map(await cached(() => loadLuckWins(year), ["luck-wins-season-v2", String(year)], { tags: [CACHE_TAGS.league] })());
}
