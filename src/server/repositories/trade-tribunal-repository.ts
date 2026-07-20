import { prisma } from "@/lib/db";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { generateTradeVerdict } from "@/server/ai/services/trade-verdict";
import type { TradeVerdictSide } from "@/server/ai/services/trade-verdict";

/** One trade, ready to render on the Trade Tribunal page. */
export interface TradeTribunalSide {
  managerId: string;
  managerName: string;
  /** Display strings for acquired players, e.g. "Josh Allen (QB)". */
  acquired: string[];
  /** Rest-of-season points the acquired players produced; null when unavailable. */
  hindsightPoints: number | null;
}

export interface TradeTribunalView {
  transactionId: string;
  seasonYear: number;
  week: number | null;
  hindsightAvailable: boolean;
  sides: TradeTribunalSide[];
  /** |A − B| of the two sides' hindsight points; null when unavailable. */
  differential: number | null;
  verdict: string;
  notable: boolean;
  notes: string | null;
}

interface WorkingSide {
  managerId: string;
  managerName: string;
  acquired: string[];
  /** playerIds this side acquired, used for hindsight scoring. */
  playerIds: string[];
  hindsightPoints: number | null;
}

function formatPlayer(p: { firstName: string; lastName: string; position: string }): string {
  return `${p.firstName} ${p.lastName} (${p.position})`;
}

/**
 * Pulls every TRADE transaction across synced seasons, scores each side by the
 * rest-of-season production of the players it acquired, and attaches an AI
 * "tribunal verdict". Sorted so the most lopsided fleeces (largest hindsight
 * differential) rank first; the page labels the top ones as fleeces.
 *
 * Hindsight formula (per side): sum of `WeeklyPlayerScore.points` for each
 * acquired player, over that trade's season, for every week >= the trade week
 * (across any roster — i.e. remaining-season production). A side's total is the
 * sum over its acquired players. The differential is |sideA − sideB|.
 *
 * Graceful gap handling: a season with zero WeeklyPlayerScore rows is flagged
 * `hindsightAvailable = false`; scoring is skipped, points are null, and the
 * verdict is told there is insufficient evidence. The trade still renders with
 * its participants and assets.
 */
export async function getTradeTribunal(): Promise<TradeTribunalView[]> {
  const trades = await prisma.transaction.findMany({
    where: { type: "TRADE" },
    include: {
      season: { select: { id: true, year: true } },
      trade: { select: { isNotable: true, notes: true } },
      assets: {
        include: {
          player: { select: { id: true, firstName: true, lastName: true, position: true } },
          fantasyTeam: {
            select: { managerId: true, manager: { select: { displayName: true } } },
          },
        },
      },
    },
    orderBy: { processedAt: "desc" },
  });

  if (trades.length === 0) return [];

  // Which seasons have any player-level scoring at all? Check once per season.
  const seasonIds = [...new Set(trades.map((t) => t.season.id))];
  const seasonHasScores = new Map<string, boolean>();
  await Promise.all(
    seasonIds.map(async (seasonId) => {
      const count = await prisma.weeklyPlayerScore.count({
        where: { roster: { fantasyTeam: { seasonId } } },
      });
      seasonHasScores.set(seasonId, count > 0);
    }),
  );

  const safeguards = await getContentSafeguards();

  const views = await Promise.all(
    trades.map(async (t): Promise<TradeTribunalView> => {
      const hindsightAvailable = seasonHasScores.get(t.season.id) ?? false;
      // Trade week drives the "rest of season" window; unknown week => count all.
      const fromWeek = t.week ?? 0;

      // Group ADD assets by the receiving manager (ADD = received/acquired).
      const bySide = new Map<string, WorkingSide>();
      for (const asset of t.assets) {
        if (asset.direction !== "ADD") continue;
        const managerId = asset.fantasyTeam.managerId;
        let side = bySide.get(managerId);
        if (!side) {
          side = {
            managerId,
            managerName: asset.fantasyTeam.manager.displayName,
            acquired: [],
            playerIds: [],
            hindsightPoints: null,
          };
          bySide.set(managerId, side);
        }
        if (asset.assetType === "PLAYER" && asset.player) {
          side.acquired.push(formatPlayer(asset.player));
          side.playerIds.push(asset.player.id);
        } else if (asset.assetType === "DRAFT_PICK") {
          side.acquired.push(asset.draftPickDescription ?? "a draft pick");
        } else if (asset.assetType === "FAAB") {
          side.acquired.push(`$${asset.faabAmount ?? 0} FAAB`);
        }
      }

      const workingSides = [...bySide.values()];

      // Hindsight scoring: rest-of-season production of each acquired player.
      if (hindsightAvailable) {
        await Promise.all(
          workingSides.map(async (side) => {
            if (side.playerIds.length === 0) {
              side.hindsightPoints = 0;
              return;
            }
            const agg = await prisma.weeklyPlayerScore.aggregate({
              _sum: { points: true },
              where: {
                playerId: { in: side.playerIds },
                roster: {
                  week: { gte: fromWeek },
                  fantasyTeam: { seasonId: t.season.id },
                },
              },
            });
            side.hindsightPoints = Number((agg._sum.points ?? 0).toFixed(1));
          }),
        );
      }

      let differential: number | null = null;
      if (hindsightAvailable && workingSides.length === 2) {
        const [a, b] = workingSides;
        differential = Number(Math.abs((a.hindsightPoints ?? 0) - (b.hindsightPoints ?? 0)).toFixed(1));
      }

      // Build the hindsight summary for the verdict prompt.
      let hindsightSummary = "insufficient evidence";
      if (hindsightAvailable && workingSides.length === 2) {
        const [a, b] = workingSides;
        const aPts = a.hindsightPoints ?? 0;
        const bPts = b.hindsightPoints ?? 0;
        if (aPts === bPts) {
          hindsightSummary = `both hauls produced ${aPts.toFixed(1)} points rest-of-season — a dead heat`;
        } else {
          const winner = aPts > bPts ? a : b;
          const loser = aPts > bPts ? b : a;
          hindsightSummary = `${winner.managerName}'s haul outscored ${loser.managerName}'s by ${Math.abs(aPts - bPts).toFixed(1)} points rest-of-season`;
        }
      }

      const verdictSides: TradeVerdictSide[] = workingSides.map((s) => ({
        managerName: s.managerName,
        acquired: s.acquired,
      }));

      const verdict = await generateTradeVerdict(
        {
          seasonYear: t.season.year,
          week: t.week,
          sides: verdictSides,
          hindsightSummary,
          hindsightAvailable,
        },
        safeguards,
      );

      return {
        transactionId: t.id,
        seasonYear: t.season.year,
        week: t.week,
        hindsightAvailable,
        sides: workingSides.map((s) => ({
          managerId: s.managerId,
          managerName: s.managerName,
          acquired: s.acquired,
          hindsightPoints: s.hindsightPoints,
        })),
        differential,
        verdict,
        notable: t.trade?.isNotable ?? false,
        notes: t.trade?.notes ?? null,
      };
    }),
  );

  // Biggest fleeces first: largest differential ranks first; unavailable last.
  return views.sort((a, b) => {
    if (a.differential == null && b.differential == null) return 0;
    if (a.differential == null) return 1;
    if (b.differential == null) return -1;
    return b.differential - a.differential;
  });
}
