import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getHeadToHeadGameLog,
} from "@/server/repositories/manager-repository";
import { getMatchupById, getRosterForTeamWeek } from "@/server/repositories/matchup-repository";
import {
  closestMeeting,
  currentStreak,
  headToHeadRecord,
  largestBlowout,
} from "@/server/stats";
import { LineChart, Sparkles } from "lucide-react";

export const metadata = { title: "Matchup" };

function LineupTable({
  title,
  roster,
}: {
  title: string;
  roster: Awaited<ReturnType<typeof getRosterForTeamWeek>>;
}) {
  if (!roster) return <EmptyState title={`No lineup data for ${title}`} />;

  const starters = roster.playerScores.filter((p) => p.isStarter);
  const bench = roster.playerScores.filter((p) => !p.isStarter);
  const benchPoints = bench.reduce((sum, p) => sum + p.points, 0);
  const highestScorer = [...roster.playerScores].sort((a, b) => b.points - a.points)[0];
  const worstStarter = [...starters].sort((a, b) => a.points - b.points)[0];

  return (
    <div>
      <h3 className="mb-2 font-heading text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-border/60">
            {starters.map((p) => (
              <tr key={p.id}>
                <td className="w-16 px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {p.lineupSlot}
                </td>
                <td className="px-3 py-1.5">
                  {p.player.firstName} {p.player.lastName}
                  <span className="ml-1 text-xs text-muted-foreground">{p.player.position}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {p.points.toFixed(1)}
                </td>
              </tr>
            ))}
            <tr className="bg-card/40">
              <td colSpan={3} className="px-3 py-1.5 text-xs font-medium tracking-wide uppercase">
                Bench ({benchPoints.toFixed(1)} pts)
              </td>
            </tr>
            {bench.map((p) => (
              <tr key={p.id} className="text-muted-foreground">
                <td className="w-16 px-3 py-1.5 font-mono text-xs">BN</td>
                <td className="px-3 py-1.5">
                  {p.player.firstName} {p.player.lastName}
                  <span className="ml-1 text-xs">{p.player.position}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {p.points.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {highestScorer ? (
          <span>
            Top scorer: <strong className="text-foreground">{highestScorer.player.firstName}{" "}
            {highestScorer.player.lastName}</strong> ({highestScorer.points.toFixed(1)})
          </span>
        ) : null}
        {worstStarter ? (
          <span>
            · Worst starter:{" "}
            <strong className="text-foreground">
              {worstStarter.player.firstName} {worstStarter.player.lastName}
            </strong>{" "}
            ({worstStarter.points.toFixed(1)})
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default async function MatchupDetailPage({
  params,
}: {
  params: Promise<{ season: string; week: string; matchupId: string }>;
}) {
  const { season, week, matchupId } = await params;
  const matchup = await getMatchupById(matchupId);

  if (!matchup || matchup.season.year !== Number(season) || matchup.week !== Number(week)) {
    notFound();
  }
  if (matchup.teams.length < 2) notFound();

  const [teamA, teamB] = matchup.teams;
  const [rosterA, rosterB] = await Promise.all([
    getRosterForTeamWeek(teamA.fantasyTeamId, matchup.week),
    getRosterForTeamWeek(teamB.fantasyTeamId, matchup.week),
  ]);

  const h2hGames = await getHeadToHeadGameLog(teamA.fantasyTeam.managerId, teamB.fantasyTeam.managerId);
  const h2hRecord = headToHeadRecord(h2hGames);
  const streak = currentStreak(h2hGames);
  const closest = closestMeeting(h2hGames);
  const blowout = largestBlowout(h2hGames);

  const isFinal = matchup.status === "FINAL";

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
        {matchup.season.year} · Week {matchup.week}
        {matchup.roundName ? ` · ${matchup.roundName}` : ""}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        {[teamA, teamB].map((t, i) => (
          <div key={t.id} className={`flex items-center gap-3 ${i === 1 ? "sm:flex-row-reverse sm:text-right" : ""}`}>
            <TeamAvatar name={t.fantasyTeam.manager.displayName} imageUrl={t.fantasyTeam.manager.avatarUrl} className="h-14 w-14" />
            <div>
              <p className="font-heading text-xl font-semibold">{t.fantasyTeam.teamName}</p>
              <p className="text-sm text-muted-foreground">{t.fantasyTeam.manager.displayName}</p>
              <p className="font-mono text-2xl font-bold tabular-nums">
                {(isFinal ? t.score : t.projectedScore)?.toFixed(1) ?? "—"}
              </p>
            </div>
          </div>
        ))}
        <div className="hidden text-center text-sm text-muted-foreground sm:block">
          {isFinal ? "FINAL" : "VS"}
        </div>
      </div>

      <Separator className="my-8" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <LineupTable title={teamA.fantasyTeam.teamName} roster={rosterA} />
        <LineupTable title={teamB.fantasyTeam.teamName} roster={rosterB} />
      </section>

      <Separator className="my-8" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="uppercase">Head-to-Head History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <strong>{teamA.fantasyTeam.manager.displayName}</strong> leads the series{" "}
              <span className="font-mono">
                {h2hRecord.wins}-{h2hRecord.losses}
                {h2hRecord.ties ? `-${h2hRecord.ties}` : ""}
              </span>
            </p>
            {streak.winner ? (
              <p className="text-muted-foreground">
                Current streak: {streak.winner === "self" ? teamA.fantasyTeam.manager.displayName : teamB.fantasyTeam.manager.displayName} has won {streak.length} straight.
              </p>
            ) : null}
            {closest ? (
              <p className="text-muted-foreground">
                Closest meeting: {Math.abs(closest.pointsFor - closest.pointsAgainst).toFixed(1)} pts (Week{" "}
                {closest.week}, {closest.season})
              </p>
            ) : null}
            {blowout ? (
              <p className="text-muted-foreground">
                Biggest blowout: {Math.abs(blowout.pointsFor - blowout.pointsAgainst).toFixed(1)} pts (Week{" "}
                {blowout.week}, {blowout.season})
              </p>
            ) : null}
            {h2hGames.length === 0 ? (
              <p className="text-muted-foreground">These managers have not yet met.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <LineChart className="h-4 w-4" /> Win Probability
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={LineChart}
              title="Chart coming soon"
              description="A live win-probability chart will render here once in-game scoring data is synced."
            />
          </CardContent>
        </Card>
      </section>

      <Separator className="my-8" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Sparkles className="h-4 w-4" /> Preview
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              An AI-generated matchup preview will appear here once this week&apos;s content has been
              generated and approved.
            </p>
            <Badge variant="outline" className="mt-3">
              AI content status: not generated
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Sparkles className="h-4 w-4" /> Recap
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {isFinal
                ? "An AI-generated recap will appear here once generated and approved."
                : "A recap will be available after this matchup is final."}
            </p>
            <Badge variant="outline" className="mt-3">
              AI content status: not generated
            </Badge>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
