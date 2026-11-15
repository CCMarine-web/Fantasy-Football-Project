import { prisma } from "@/lib/db";

export async function getDraftForSeasonYear(year: number) {
  return prisma.draft.findFirst({
    where: { season: { year } },
    include: {
      season: true,
      picks: {
        include: { player: true, manager: true, fantasyTeam: true },
        orderBy: { pickNumber: "asc" },
      },
    },
  });
}

export async function listDraftSeasons() {
  return prisma.season.findMany({
    where: { drafts: { some: {} } },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  });
}

// ---------------------------------------------------------------------------
// The draft board: team columns x rounds
// ---------------------------------------------------------------------------

export interface DraftBoardTeam {
  fantasyTeamId: string;
  managerId: string | null;
  managerName: string;
  teamName: string;
  /** 1-based column: the team's place in the round-1 order. */
  column: number;
}

export interface DraftBoardCell {
  pickNumber: number;
  round: number;
  /** 1-based position within the round, in the order the picks were made. */
  pickInRound: number;
  playerName: string;
  /** Raw position code (QB, RB, WR, TE, K, DEF). */
  position: string | null;
  /** Short tag for the board ("D/ST" rather than "Team D/ST"). */
  positionTag: string;
  nflTeam: string | null;
  isKeeper: boolean;
  /** Who made the pick, when the slot changed hands before the draft. */
  pickedBy: string | null;
}

export interface DraftBoard {
  seasonId: string;
  seasonYear: number;
  status: "UPCOMING" | "IN_PROGRESS" | "COMPLETE";
  dataSource: string;
  teams: DraftBoardTeam[];
  /** One row per round, one cell per team column (null where no pick exists). */
  rounds: { round: number; direction: "ltr" | "rtl"; cells: (DraftBoardCell | null)[] }[];
  pickCount: number;
}

function positionTag(position: string | null): string {
  const p = (position ?? "").toUpperCase();
  if (p === "DEF" || p === "DST" || p === "D/ST" || p === "DL") return "D/ST";
  return p || "—";
}

/** A defence is listed as "Houston Texans" or "Texans D/ST"; the board wants the team, once. */
function playerName(player: { firstName: string; lastName: string; position: string } | null): string {
  if (!player) return "(no player on record)";
  const name = `${player.firstName} ${player.lastName}`.trim();
  return positionTag(player.position) === "D/ST" ? name.replace(/\s+D\/?ST$/i, "") : name;
}

/**
 * The full board for one season, laid out the way it looked in the room: a
 * column per team in round-1 order, a row per round.
 *
 * Columns come from the round-1 pick order of each slot's ORIGINAL owner, not
 * from `draftSlot`: the ESPN import stores `draftSlot` as the pick's position
 * within its round (1-10 every round), while Sleeper stores the team's column.
 * Reading the order off the picks themselves works for both, and a snake draft
 * then shows its snake.
 */
export async function getDraftBoard(year: number): Promise<DraftBoard | null> {
  const draft = await prisma.draft.findFirst({
    where: { season: { year } },
    select: {
      season: { select: { id: true, year: true, status: true, dataSource: true } },
      picks: {
        select: {
          round: true,
          pickNumber: true,
          isKeeper: true,
          fantasyTeamId: true,
          originalFantasyTeamId: true,
          player: { select: { firstName: true, lastName: true, position: true, nflTeam: true } },
          manager: { select: { id: true, displayName: true } },
          fantasyTeam: { select: { teamName: true } },
          originalFantasyTeam: {
            select: { id: true, teamName: true, manager: { select: { id: true, displayName: true } } },
          },
        },
        orderBy: { pickNumber: "asc" },
      },
    },
  });
  if (!draft || draft.picks.length === 0) return null;

  // Column order: the round-1 order, then any team that had no round-1 pick.
  const order: string[] = [];
  const teamInfo = new Map<string, DraftBoardTeam>();
  const sorted = [...draft.picks].sort((a, b) => a.round - b.round || a.pickNumber - b.pickNumber);
  for (const pick of sorted) {
    const id = pick.originalFantasyTeamId;
    if (teamInfo.has(id)) continue;
    order.push(id);
    teamInfo.set(id, {
      fantasyTeamId: id,
      managerId: pick.originalFantasyTeam.manager?.id ?? null,
      managerName: pick.originalFantasyTeam.manager?.displayName ?? "Unknown Manager",
      teamName: pick.originalFantasyTeam.teamName,
      column: order.length,
    });
  }

  const byRound = new Map<number, typeof draft.picks>();
  for (const pick of draft.picks) {
    const list = byRound.get(pick.round) ?? [];
    list.push(pick);
    byRound.set(pick.round, list);
  }

  const rounds = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, picks]) => {
      const inOrder = [...picks].sort((a, b) => a.pickNumber - b.pickNumber);
      const cells: (DraftBoardCell | null)[] = order.map(() => null);
      inOrder.forEach((pick, index) => {
        const column = teamInfo.get(pick.originalFantasyTeamId)?.column ?? 0;
        if (column < 1) return;
        cells[column - 1] = {
          pickNumber: pick.pickNumber,
          round,
          pickInRound: index + 1,
          playerName: playerName(pick.player),
          position: pick.player?.position ?? null,
          positionTag: positionTag(pick.player?.position ?? null),
          nflTeam: pick.player?.nflTeam ?? null,
          isKeeper: pick.isKeeper,
          pickedBy:
            pick.fantasyTeamId !== pick.originalFantasyTeamId
              ? (pick.manager?.displayName ?? pick.fantasyTeam.teamName)
              : null,
        };
      });
      const first = teamInfo.get(inOrder[0].originalFantasyTeamId)?.column ?? 1;
      const last = teamInfo.get(inOrder[inOrder.length - 1].originalFantasyTeamId)?.column ?? 1;
      return { round, direction: (first <= last ? "ltr" : "rtl") as "ltr" | "rtl", cells };
    });

  return {
    seasonId: draft.season.id,
    seasonYear: draft.season.year,
    status: draft.season.status,
    dataSource: draft.season.dataSource,
    teams: order.map((id) => teamInfo.get(id)!),
    rounds,
    pickCount: draft.picks.length,
  };
}
