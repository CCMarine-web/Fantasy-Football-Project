import "../lib/load-env";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { fetchPlayers, fetchSeason, hasCredentials, redactSecrets } from "./espn/client";
import { positionFromEspn, proTeamFromEspn } from "./espn/reference";

/**
 * Audits every imported draft board and recovers picks whose player went
 * missing on import.
 *
 *   npx tsx scripts/import/audit-draft-data.ts            # report only
 *   npx tsx scripts/import/audit-draft-data.ts --repair   # recover what it can
 *
 * ── Why picks go blank ────────────────────────────────────────────────────
 * A blank slot on a draft board has several possible causes, and they are not
 * interchangeable. This script separates them:
 *
 *  RECOVERABLE       The platform still names the player; the import simply
 *                    failed to resolve the id. ESPN's archived league views
 *                    only describe players still rostered at season end, so a
 *                    drafted-then-dropped player arrives as a bare id and needs
 *                    a second lookup against /seasons/{year}/players.
 *  KEEPER            The slot was consumed by a keeper rather than a selection.
 *  NO PICK MADE      The platform reports no selection for that slot at all —
 *                    a skipped or forfeited pick.
 *  PLATFORM GAP      The platform returns an id but no longer has a record for
 *                    that player, so the name is genuinely unrecoverable.
 *
 * Only the first is repaired. The rest are reported with the reason, because
 * inventing a name for a slot the platform cannot describe would be worse than
 * a blank.
 */

interface Unresolved {
  year: number;
  round: number;
  pickNumber: number;
  manager: string;
  reason: string;
}

async function main() {
  const repair = process.argv.includes("--repair");
  console.log(`=== draft data audit ===${repair ? " (REPAIR)" : " (report only)"}`);

  const drafts = await prisma.draft.findMany({
    select: {
      id: true,
      rounds: true,
      type: true,
      season: { select: { id: true, year: true, dataSource: true } },
      picks: {
        select: {
          id: true,
          round: true,
          pickNumber: true,
          playerId: true,
          isKeeper: true,
          manager: { select: { displayName: true } },
        },
        orderBy: { pickNumber: "asc" },
      },
    },
    orderBy: { season: { year: "asc" } },
  });

  const unresolved: Unresolved[] = [];
  let repaired = 0;
  const leagueId = getEnv().ESPN_LEAGUE_ID;

  for (const draft of drafts) {
    const { year, dataSource } = draft.season;
    const blanks = draft.picks.filter((p) => !p.playerId);
    const teams = new Set(draft.picks.map((p) => p.manager?.displayName)).size;
    const expected = draft.rounds * teams;

    if (draft.picks.length === 0) {
      console.log(`  ${year}: no picks on record (draft not held or not synced)`);
      continue;
    }

    console.log(
      `  ${year} ${dataSource.padEnd(7)} ${draft.picks.length}/${expected} picks · ${blanks.length} blank · ${draft.picks.filter((p) => p.isKeeper).length} keeper(s)`,
    );
    if (blanks.length === 0) continue;

    // ── ESPN: re-read the draft board and look the ids up directly ──────────
    if (dataSource === "ESPN") {
      if (!hasCredentials()) {
        for (const p of blanks) {
          unresolved.push({
            year,
            round: p.round,
            pickNumber: p.pickNumber,
            manager: p.manager?.displayName ?? "?",
            reason: "ESPN credentials not configured, so the player id could not be looked up",
          });
        }
        continue;
      }

      let espnPicks: { overallPickNumber: number; playerId: number; keeper?: boolean }[] = [];
      try {
        const data = await fetchSeason(leagueId, year, ["mDraftDetail"]);
        espnPicks = data.draftDetail?.picks ?? [];
      } catch (error) {
        const reason = redactSecrets(error instanceof Error ? error.message : String(error));
        for (const p of blanks) {
          unresolved.push({
            year,
            round: p.round,
            pickNumber: p.pickNumber,
            manager: p.manager?.displayName ?? "?",
            reason,
          });
        }
        continue;
      }

      const espnByPick = new Map(espnPicks.map((p) => [p.overallPickNumber, p]));
      const wantedIds = [
        ...new Set(
          blanks
            .map((p) => espnByPick.get(p.pickNumber)?.playerId)
            .filter((id): id is number => typeof id === "number" && id > 0),
        ),
      ];
      const looked = wantedIds.length > 0 ? await fetchPlayers(year, wantedIds) : [];
      const lookedById = new Map(looked.map((p) => [p.id, p]));

      for (const pick of blanks) {
        const espnPick = espnByPick.get(pick.pickNumber);
        const label = {
          year,
          round: pick.round,
          pickNumber: pick.pickNumber,
          manager: pick.manager?.displayName ?? "?",
        };

        if (!espnPick || !espnPick.playerId) {
          unresolved.push({
            ...label,
            reason: "ESPN reports no selection for this slot (skipped or forfeited pick)",
          });
          continue;
        }
        if (espnPick.keeper) {
          unresolved.push({ ...label, reason: "slot consumed by a keeper, not a selection" });
          continue;
        }

        const info = lookedById.get(espnPick.playerId);
        if (!info) {
          unresolved.push({
            ...label,
            reason: `ESPN returns player id ${espnPick.playerId} for this pick but no longer has a record describing that player`,
          });
          continue;
        }

        const [first, ...rest] = (info.fullName ?? "").split(" ");
        const firstName = info.firstName?.trim() || first || "";
        const lastName = info.lastName?.trim() || rest.join(" ") || "";
        if (!firstName && !lastName) {
          unresolved.push({
            ...label,
            reason: `ESPN record for player id ${espnPick.playerId} carries no name`,
          });
          continue;
        }

        if (!repair) {
          console.log(
            `      RECOVERABLE pick ${pick.pickNumber} (R${pick.round}) -> ${firstName} ${lastName}`,
          );
          continue;
        }

        // Reuse an existing row for this player where possible, so the same
        // human is not duplicated across eras.
        let player = await prisma.fantasyPlayer.findUnique({
          where: { espnPlayerId: espnPick.playerId },
          select: { id: true },
        });
        if (!player) {
          const position = positionFromEspn(info.defaultPositionId);
          const matches = await prisma.fantasyPlayer.findMany({
            where: {
              firstName: { equals: firstName, mode: "insensitive" },
              lastName: { equals: lastName, mode: "insensitive" },
              ...(position ? { position } : {}),
              espnPlayerId: null,
            },
            select: { id: true },
            take: 2,
          });
          player =
            matches.length === 1
              ? await prisma.fantasyPlayer.update({
                  where: { id: matches[0].id },
                  data: { espnPlayerId: espnPick.playerId },
                  select: { id: true },
                })
              : await prisma.fantasyPlayer.create({
                  data: {
                    espnPlayerId: espnPick.playerId,
                    firstName,
                    lastName,
                    position: position ?? "UNK",
                    nflTeam: proTeamFromEspn(info.proTeamId) ?? null,
                  },
                  select: { id: true },
                });
        }

        await prisma.draftPick.update({ where: { id: pick.id }, data: { playerId: player.id } });
        repaired++;
      }
      continue;
    }

    // ── Sleeper: the draft-pick payload always names the player, so a blank
    // here means the pick row was written without one. Report rather than
    // guess; re-running the Sleeper sync is the fix.
    for (const pick of blanks) {
      unresolved.push({
        year,
        round: pick.round,
        pickNumber: pick.pickNumber,
        manager: pick.manager?.displayName ?? "?",
        reason: pick.isKeeper
          ? "slot consumed by a keeper, not a selection"
          : "Sleeper pick row has no player attached — re-run the Sleeper draft sync for this season",
      });
    }
  }

  const remaining = await prisma.draftPick.count({ where: { playerId: null } });
  const total = await prisma.draftPick.count();

  console.log(`\n=== result ===`);
  if (repair) console.log(`recovered ${repaired} pick(s)`);
  console.log(`blank picks remaining: ${remaining}/${total}`);

  if (unresolved.length > 0) {
    console.log(`\nunresolved (${unresolved.length}) — grouped by reason:`);
    const byReason = new Map<string, Unresolved[]>();
    for (const u of unresolved) {
      const list = byReason.get(u.reason) ?? [];
      list.push(u);
      byReason.set(u.reason, list);
    }
    for (const [reason, list] of byReason) {
      console.log(`\n  ${list.length}x ${reason}`);
      for (const u of list.slice(0, 8)) {
        console.log(`      ${u.year} R${u.round} pick ${u.pickNumber} (${u.manager})`);
      }
      if (list.length > 8) console.log(`      ...and ${list.length - 8} more`);
    }
  } else {
    console.log("nothing unresolved.");
  }

  if (repair && repaired > 0) {
    console.log(
      "\nDraft data changed — regrade with: npx tsx scripts/ai/regenerate-draft-grades.ts",
    );
  }
}

main()
  .catch((error) => {
    console.error(
      redactSecrets(error instanceof Error ? (error.stack ?? error.message) : String(error)),
    );
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
