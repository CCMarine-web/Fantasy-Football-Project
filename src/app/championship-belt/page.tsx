import Link from "next/link";
import { Crown, Trophy, Quote, Flame, Pencil } from "lucide-react";
import { auth } from "@/auth";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DaysAsChampion } from "@/components/championship/days-as-champion";
import { DaysSinceCounter } from "@/components/championship/days-since-counter";
import { LEAGUE_CONFIG } from "@/lib/league-config";
import {
  getCurrentChampion,
  getChampionLineage,
} from "@/server/repositories/championship-belt-repository";

export const metadata = { title: "Championship Belt" };

function recordLine(w: number, l: number, t: number): string {
  return `${w}-${l}${t ? `-${t}` : ""}`;
}

export default async function ChampionshipBeltPage() {
  const [champion, lineage, session] = await Promise.all([
    getCurrentChampion(),
    getChampionLineage(),
    auth(),
  ]);
  const isAdmin = session?.user?.role === "ADMIN";
  const shame = LEAGUE_CONFIG.shameCounter;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Who Wears the Crown"
        title="Championship Belt"
        description="The reigning champion, the length of their reign, and the full lineage of everyone who has held the title."
      />

      {!champion ? (
        <div className="mt-8">
          <EmptyState
            icon={Trophy}
            title="No champion crowned yet"
            description="The belt is up for grabs. A champion appears here once a season is completed and its title is recorded."
          />
        </div>
      ) : (
        <>
          {/* Hero — reigning champion */}
          <section className="mt-8">
            <Card className="ring-primary/30">
              <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
                <div className="flex shrink-0 flex-col items-center gap-2">
                  <TeamAvatar
                    name={champion.managerName}
                    imageUrl={champion.photoUrl}
                    className="h-28 w-28 ring-2 ring-primary/50"
                  />
                  <Badge className="gap-1">
                    <Crown className="h-3 w-3" /> {champion.year} Champion
                  </Badge>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
                    Reigning Champion
                  </p>
                  <h2 className="mt-1 font-heading text-3xl font-semibold tracking-wide uppercase sm:text-4xl">
                    <Link href={`/managers/${champion.managerId}`} className="hover:text-primary">
                      {champion.managerName}
                    </Link>
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{champion.teamName}</p>

                  <div className="mt-4">
                    <DaysAsChampion isoStart={champion.championSince} />
                  </div>

                  {/* Title-run stat line */}
                  <p className="mt-4 text-sm text-foreground/90">
                    <span className="font-medium">Title run:</span>{" "}
                    {recordLine(champion.wins, champion.losses, champion.ties)} regular season
                    {champion.regularSeasonRank ? ` · #${champion.regularSeasonRank} seed` : ""} ·{" "}
                    {champion.pointsFor.toFixed(1)} PF
                  </p>

                  {champion.playoffRun.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {champion.playoffRun.map((g) => (
                        <li key={g.week} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs tracking-wide uppercase">
                            {g.roundName ?? `Week ${g.week}`}
                          </span>
                          {g.result ? (
                            <Badge
                              variant={g.result === "W" ? "default" : "outline"}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {g.result}
                            </Badge>
                          ) : null}
                          <span className="font-mono tabular-nums text-foreground/90">
                            {g.championScore?.toFixed(1) ?? "—"}–{g.opponentScore?.toFixed(1) ?? "—"}
                          </span>
                          <span>vs {g.opponentName}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No playoff game data on record for this title.
                    </p>
                  )}

                  {/* Victory speech */}
                  <div className="mt-5 rounded-lg border border-border/60 bg-card/40 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="flex items-center gap-2 font-heading text-xs font-semibold tracking-wide uppercase">
                        <Quote className="h-4 w-4 text-primary" /> Victory Speech
                      </p>
                      {isAdmin ? (
                        <Link
                          href="/championship-belt/edit"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Link>
                      ) : null}
                    </div>
                    {champion.victorySpeech ? (
                      <p className="text-sm whitespace-pre-line text-foreground/90 italic">
                        “{champion.victorySpeech}”
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">
                        No victory speech recorded yet.
                        {isAdmin ? " Add one from the edit page." : ""}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* Shame counter */}
          {shame.enabled ? (
            <section className="mt-8">
              <Card>
                <CardContent>
                  <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
                    <Flame className="h-4 w-4" /> The Shame Counter
                  </p>
                  <div className="mt-3">
                    <DaysSinceCounter
                      isoStart={shame.sinceDate}
                      label={`since ${shame.managerName} ${shame.eventLabel}`}
                    />
                  </div>
                </CardContent>
              </Card>
            </section>
          ) : null}

          {/* Title history / lineage */}
          <section className="mt-10">
            <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
              <Trophy className="h-5 w-5" /> Title History
            </h2>
            {lineage.length === 0 ? (
              <EmptyState title="No titles recorded yet" />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                    <tr>
                      <th className="px-4 py-2 text-left">Season</th>
                      <th className="px-4 py-2 text-left">Champion</th>
                      <th className="px-4 py-2 text-left">Team</th>
                      <th className="px-4 py-2 text-left">Runner-Up</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lineage.map((row) => (
                      <tr key={row.seasonId}>
                        <td className="px-4 py-2 font-medium tabular-nums">{row.year}</td>
                        <td className="px-4 py-2">
                          <Link
                            href={`/managers/${row.championManagerId}`}
                            className="inline-flex items-center gap-1.5 font-medium hover:text-primary"
                          >
                            <Crown className="h-3.5 w-3.5 text-primary" />
                            {row.championName}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{row.championTeamName}</td>
                        <td className="px-4 py-2 text-muted-foreground">{row.runnerUpName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
