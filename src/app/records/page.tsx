import { prisma } from "@/lib/db";
import { ManagerLink } from "@/components/shared/manager-link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import {
  getComputedRecords,
  type RecordEntry,
} from "@/server/repositories/computed-records-repository";
import { Award } from "lucide-react";

export const metadata = { title: "Records" };

/**
 * The Closest Game margin is printed to two decimals but its detail line to
 * one, so a 0.08-point win read "122.9–122.8" — a 0.1 margin. Under a point,
 * the game is looked up and both scores are shown to two decimals as well.
 *
 * The record carries only display strings, so the game is found by its holder
 * and the "Week N, YYYY" in the detail, and is accepted only if its margin is
 * the one in the headline. Anything that does not match keeps the stored line.
 */
async function withPreciseClosestGame(records: RecordEntry[]): Promise<RecordEntry[]> {
  const closest = records.find((r) => r.key === "closest");
  if (!closest?.holderManagerId) return records;
  const margin = Number.parseFloat(closest.value);
  const when = /Week (\d+), (\d{4})/.exec(closest.detail);
  if (!Number.isFinite(margin) || margin >= 1 || !when) return records;

  const game = await prisma.matchup.findFirst({
    where: {
      week: Number(when[1]),
      season: { year: Number(when[2]) },
      teams: { some: { isWinner: true, fantasyTeam: { managerId: closest.holderManagerId } } },
    },
    select: {
      teams: { select: { score: true, isWinner: true, fantasyTeam: { select: { managerId: true } } } },
    },
  });
  const winner = game?.teams.find(
    (t) => t.isWinner === true && t.fantasyTeam.managerId === closest.holderManagerId,
  );
  const loser = game?.teams.find((t) => t !== winner);
  if (winner?.score == null || loser?.score == null) return records;
  // The headline margin is rounded to 0.01, so the real one is within half of that.
  if (Math.abs(winner.score - loser.score - margin) > 0.006) return records;

  const detail = closest.detail.replace(
    /^[\d.]+–[\d.]+/,
    `${winner.score.toFixed(2)}–${loser.score.toFixed(2)}`,
  );
  return records.map((r) => (r === closest ? { ...r, detail } : r));
}

export default async function RecordsPage() {
  const records = await withPreciseClosestGame(await getComputedRecords());

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader freshness
        eyebrow="The Ledger"
        title="League Records"
        description="Every record on the books, computed live across all synced seasons."
      />

      {/*
       * What "all games" means here, said once. Single-game and streak records
       * span every game a manager played — a title-game score is still a score
       * — but season records are the regular season, because that is what a
       * season row is. Saying so is the difference between a record book and a
       * pile of numbers.
       */}
      <p className="mt-4 max-w-prose text-sm text-muted-foreground">
        Single-game and streak records count <strong className="text-foreground">every game</strong>{" "}
        a manager has played, regular season and postseason alike, and the detail line names the week.
        Season records — most points, best and worst record — are the{" "}
        <strong className="text-foreground">regular season</strong>, matching the season tables
        elsewhere on the site. Scores that could not be verified as real contest results are excluded;
        see the Hall of Shame for what that covers.
      </p>

      <div className="mt-8">
        {records.length === 0 ? (
          <EmptyState icon={Award} title="No records yet" description="Records populate once games have been played and synced." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {records.map((r) => (
              <Card key={r.key}>
                <CardContent>
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">{r.label}</p>
                  <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{r.value}</p>
                  <p className="mt-1 text-sm font-medium">
                    {r.holderManagerId ? (
                      <ManagerLink managerId={r.holderManagerId}>{r.holderName}</ManagerLink>
                    ) : (
                      r.holderName
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.detail}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
