import { prisma } from "@/lib/db";
import { loadVerifiedGames } from "@/server/repositories/verified-games";
import { seriesFromRows } from "@/server/repositories/head-to-head-repository";
import { headToHeadLines } from "@/server/repositories/manager-repository";

/**
 * The database-backed half of the cross-page consistency guarantee: for every
 * manager pair, the STORED rivalry row (what /rivalries renders), the profile
 * head-to-head list and the matchup-card series must have the same record and
 * meeting count. Run by `npm run verify:data` and by the pipeline's compute
 * step, after the rivalry recompute.
 */
export interface H2HInconsistency {
  pair: string;
  rivalry: string;
  profile: string;
  matchup: string;
}

export async function verifyHeadToHeadConsistency(): Promise<{ pairsChecked: number; problems: H2HInconsistency[] }> {
  const [rows, rivalries, managers] = await Promise.all([
    loadVerifiedGames(),
    prisma.rivalry.findMany({
      select: { managerAId: true, managerBId: true, gamesPlayed: true, managerAWins: true, managerBWins: true, ties: true },
    }),
    prisma.manager.findMany({ select: { id: true, displayName: true } }),
  ]);
  const name = new Map(managers.map((m) => [m.id, m.displayName]));
  const stored = new Map(rivalries.map((r) => [`${r.managerAId}|${r.managerBId}`, r]));
  const profiles = new Map(managers.map((m) => [m.id, headToHeadLines(rows, m.id)]));

  const ids = managers.map((m) => m.id).sort();
  const problems: H2HInconsistency[] = [];
  let pairsChecked = 0;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i];
      const b = ids[j];
      const s = seriesFromRows(rows, a, b);
      const r = stored.get(`${a}|${b}`);
      const p = profiles.get(a)?.find((l) => l.opponentId === b);
      if (s.games === 0 && (!r || r.gamesPlayed === 0) && !p) continue;
      pairsChecked += 1;
      const fmt = (w?: number, l?: number, t?: number, g?: number) => `${w ?? 0}-${l ?? 0}-${t ?? 0}/${g ?? 0}`;
      const matchup = fmt(s.aWins, s.bWins, s.ties, s.games);
      const rivalry = fmt(r?.managerAWins, r?.managerBWins, r?.ties, r?.gamesPlayed);
      const profile = fmt(p?.wins, p?.losses, p?.ties, p?.games);
      if (matchup !== rivalry || matchup !== profile) {
        problems.push({ pair: `${name.get(a)} vs ${name.get(b)}`, rivalry, profile, matchup });
      }
    }
  }
  return { pairsChecked, problems };
}
