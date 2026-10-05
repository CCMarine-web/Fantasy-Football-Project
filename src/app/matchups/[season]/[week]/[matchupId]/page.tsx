import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DataFreshness } from "@/components/shared/data-freshness";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getHeadToHeadGameLog,
} from "@/server/repositories/manager-repository";
import { getMatchupById, getRosterForTeamWeek } from "@/server/repositories/matchup-repository";
import { positionLabel } from "@/lib/format";
import { getMatchupAIContent } from "@/server/ai/weekly-pipeline";
import {
  closestMeeting,
  currentStreak,
  headToHeadRecord,
  largestBlowout,
} from "@/server/stats";
import { ArrowLeft, Sparkles } from "lucide-react";

/** One load per request, shared by generateMetadata and the page. */
const loadMatchup = cache(async (matchupId: string) => getMatchupById(matchupId));

type Params = { season: string; week: string; matchupId: string };

/**
 * The title and description a group-chat link unfurls with: who played, when,
 * and — once it is final — the score.
 */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { matchupId } = await params;
  const m = await loadMatchup(matchupId);
  if (!m || m.teams.length < 2) return { title: "Matchup" };
  const [a, b] = m.teams;
  const when = `Week ${m.week}, ${m.season.year}${m.roundName ? ` · ${m.roundName}` : ""}`;
  const title = `${a.fantasyTeam.teamName} vs ${b.fantasyTeam.teamName} — ${when}`;
  const final = m.status === "FINAL" && a.score != null && b.score != null;
  const description = final
    ? `Final: ${a.fantasyTeam.manager.displayName} ${a.score!.toFixed(1)}, ${b.fantasyTeam.manager.displayName} ${b.score!.toFixed(1)}.`
    : `${a.fantasyTeam.manager.displayName} vs ${b.fantasyTeam.manager.displayName}, ${when}. Lineups, head-to-head history and the preview.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

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
  // ESPN's archived seasons give roster membership without a trustworthy
  // per-week score. The lineup is still worth showing; the points column and
  // the top/worst-scorer notes are simply omitted rather than shown as 0.0.
  const scored = roster.playerScores.filter((p): p is typeof p & { points: number } => p.points != null);
  const hasPoints = scored.length === roster.playerScores.length && scored.length > 0;
  const benchPoints = bench.reduce((sum, p) => sum + (p.points ?? 0), 0);
  const highestScorer = hasPoints ? [...scored].sort((a, b) => b.points - a.points)[0] : null;
  const worstStarter = hasPoints
    ? [...starters]
        .filter((p): p is typeof p & { points: number } => p.points != null)
        .sort((a, b) => a.points - b.points)[0]
    : null;
  const fmt = (points: number | null) => (points == null ? "—" : points.toFixed(1));

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
                  <span className="ml-1 text-xs text-muted-foreground">
                    {positionLabel(p.player.position)}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {fmt(p.points)}
                </td>
              </tr>
            ))}
            <tr className="bg-card/40">
              <td colSpan={3} className="px-3 py-1.5 text-xs font-medium tracking-wide uppercase">
                Bench{hasPoints ? ` (${benchPoints.toFixed(1)} pts)` : ""}
              </td>
            </tr>
            {bench.map((p) => (
              <tr key={p.id} className="text-muted-foreground">
                <td className="w-16 px-3 py-1.5 font-mono text-xs">BN</td>
                <td className="px-3 py-1.5">
                  {p.player.firstName} {p.player.lastName}
                  <span className="ml-1 text-xs">{positionLabel(p.player.position)}</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                  {fmt(p.points)}
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
  params: Promise<Params>;
}) {
  const { season, week, matchupId } = await params;
  const matchup = await loadMatchup(matchupId);

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
  const statusLabel = isFinal ? "Final" : matchup.status === "IN_PROGRESS" ? "Live" : "Upcoming";
  const aiContent = await getMatchupAIContent(matchup.id);
  // Placeholder copy is never shown as if it were real writing.
  const preview = aiContent.isMock ? null : aiContent.preview;
  const recap = aiContent.isMock ? null : aiContent.recap;

  // The series from teamA's side; name whoever actually leads it.
  const nameA = teamA.fantasyTeam.manager.displayName;
  const nameB = teamB.fantasyTeam.manager.displayName;
  const tiesSuffix = h2hRecord.ties ? `-${h2hRecord.ties}` : "";
  const series =
    h2hRecord.wins === h2hRecord.losses
      ? { leader: null, score: `Series tied ${h2hRecord.wins}-${h2hRecord.losses}${tiesSuffix}` }
      : h2hRecord.wins > h2hRecord.losses
        ? { leader: nameA, score: `${h2hRecord.wins}-${h2hRecord.losses}${tiesSuffix}` }
        : { leader: nameB, score: `${h2hRecord.losses}-${h2hRecord.wins}${tiesSuffix}` };

  // Recap first once the game is over; before then the preview leads.
  const writing = [
    {
      key: "recap",
      title: "Recap",
      text: recap,
      empty: isFinal ? "No recap has been written for this game." : "The recap is written once this game is final.",
    },
    { key: "preview", title: "Preview", text: preview, empty: "No preview was written for this game." },
  ];
  if (!isFinal) writing.reverse();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <Link
        href={`/matchups?week=${matchup.week}`}
        className="inline-flex min-h-10 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Week {matchup.week} matchups
      </Link>
      <p className="mt-2 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
        {matchup.season.year} · Week {matchup.week}
        {matchup.roundName ? ` · ${matchup.roundName}` : ""} · {statusLabel}
      </p>
      <h1 className="mt-1 font-heading text-2xl font-semibold tracking-wide break-words uppercase sm:text-3xl">
        {teamA.fantasyTeam.teamName} <span className="text-muted-foreground">vs</span>{" "}
        {teamB.fantasyTeam.teamName}
      </h1>
      <DataFreshness className="mt-2" />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        {[teamA, teamB].map((t, i) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 ${i === 1 ? "order-3 sm:flex-row-reverse sm:text-right" : "order-1"}`}
          >
            <TeamAvatar name={t.fantasyTeam.manager.displayName} imageUrl={t.fantasyTeam.manager.photoUrl ?? t.fantasyTeam.manager.avatarUrl} className="h-14 w-14" />
            <div>
              <p className="font-heading text-xl font-semibold">{t.fantasyTeam.teamName}</p>
              <p className="text-sm text-muted-foreground">{t.fantasyTeam.manager.displayName}</p>
              <p className={`font-mono text-2xl font-bold tabular-nums ${isFinal && t.isWinner ? "text-primary" : ""}`}>
                {(isFinal ? t.score : t.projectedScore)?.toFixed(1) ?? "—"}
              </p>
            </div>
          </div>
        ))}
        {/* Between the teams at every width, so a phone still says how it ended. */}
        <div className="order-2 text-center text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          {isFinal ? "Final" : "vs"}
        </div>
      </div>

      <Separator className="my-8" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <LineupTable title={teamA.fantasyTeam.teamName} roster={rosterA} />
        <LineupTable title={teamB.fantasyTeam.teamName} roster={rosterB} />
      </section>

      <Separator className="my-8" />

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="uppercase">Head-to-Head History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {h2hGames.length > 0 ? (
              <p>
                {series.leader ? (
                  <>
                    <strong>{series.leader}</strong> leads the series <span className="font-mono">{series.score}</span>
                  </>
                ) : (
                  <span className="font-mono">{series.score}</span>
                )}
              </p>
            ) : null}
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

      </section>

      <Separator className="my-8" />

      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {writing.map((block) => (
          <Card key={block.key}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 uppercase">
                <Sparkles className="h-4 w-4" aria-hidden /> {block.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {block.text ? (
                <p className="text-sm whitespace-pre-line text-foreground/90">{block.text}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{block.empty}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
