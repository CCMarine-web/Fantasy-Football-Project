import { notFound } from "next/navigation";
import { ManagerLink } from "@/components/shared/manager-link";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { EmptyState } from "@/components/shared/empty-state";
import { TeamPointsBarChart } from "@/components/charts/team-points-bar-chart";
import { getSeasonArticle, getSeasonHistory } from "@/server/repositories/history-repository";
import { getTradeTribunal } from "@/server/repositories/trade-tribunal-repository";
import { LOPSIDEDNESS_LABEL } from "@/server/stats/trade-value";
import { Sparkles, Trophy } from "lucide-react";

export const metadata = { title: "Season History" };

const SEASON_STATUS_LABEL: Record<string, string> = {
  UPCOMING: "Upcoming",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};


export default async function SeasonHistoryPage({
  params,
}: {
  params: Promise<{ season: string }>;
}) {
  const { season: seasonParam } = await params;
  const year = Number(seasonParam);
  const [data, article, allTrades] = await Promise.all([
    getSeasonHistory(year),
    getSeasonArticle(year),
    getTradeTribunal(),
  ]);
  if (!data) notFound();

  const { season, playoffMatchups, highestScore } = data;
  // Trades for this season, most one-sided first (the Tribunal already sorts).
  const seasonTrades = allTrades.filter((t) => t.seasonYear === year);
  const biggestTrade = seasonTrades[0] ?? null;
  const draft = season.drafts[0];

  const pointsChartData = season.fantasyTeams.map((t) => ({
    teamName: t.teamName,
    pointsFor: t.pointsFor,
  }));

  const playoffRounds = new Map<string, typeof playoffMatchups>();
  for (const m of playoffMatchups) {
    const key = m.roundName ?? "Playoffs";
    const list = playoffRounds.get(key) ?? [];
    list.push(m);
    playoffRounds.set(key, list);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
        {SEASON_STATUS_LABEL[season.status] ?? season.status}
      </p>
      <h1 className="font-heading text-4xl font-semibold tracking-wide uppercase">{season.year} Season</h1>

      {season.championship ? (
        <Card className="mt-6 border-gold/40 bg-gold/5">
          <CardContent className="flex items-center gap-4">
            <Trophy className="h-10 w-10 text-gold" />
            <div>
              <p className="text-xs tracking-wide text-muted-foreground uppercase">Champion</p>
              <p className="font-heading text-xl font-semibold">
                {season.championship.championFantasyTeam.manager.displayName}
              </p>
              <p className="text-sm text-muted-foreground">
                {season.championship.championFantasyTeam.teamName}
                {season.championship.runnerUpFantasyTeam
                  ? ` defeated ${season.championship.runnerUpFantasyTeam.manager.displayName}`
                  : ""}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Separator className="my-8" />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
            Regular Season Standings
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">#</th>
                  <th className="px-3 py-2 text-left">Team</th>
                  <th className="px-3 py-2 text-right">W-L-T</th>
                  <th className="px-3 py-2 text-right">PF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {season.fantasyTeams.map((t, i) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 font-mono text-muted-foreground">
                      {t.regularSeasonRank ?? i + 1}
                    </td>
                    <td className="px-3 py-2">
                      <ManagerLink managerId={t.managerId}>{t.teamName}</ManagerLink>
                      <span className="ml-1 text-xs text-muted-foreground">{t.manager.displayName}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {t.wins}-{t.losses}
                      {t.ties ? `-${t.ties}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{t.pointsFor.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
            Points For by Team
          </h2>
          <Card>
            <CardContent>
              <TeamPointsBarChart data={pointsChartData} />
            </CardContent>
          </Card>
        </section>
      </div>

      <Separator className="my-8" />

      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
          Playoff Bracket
        </h2>
        {playoffMatchups.length === 0 ? (
          <EmptyState title="No playoff data for this season yet" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from(playoffRounds.entries()).map(([round, matchups]) => (
              <div key={round}>
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {round}
                </p>
                <div className="space-y-2">
                  {matchups.map((m) => (
                    <Card key={m.id} className="p-3">
                      {m.teams.map((t) => (
                        <div key={t.id} className="flex items-center justify-between text-sm">
                          <span className={t.isWinner ? "font-semibold" : "text-muted-foreground"}>
                            {t.fantasyTeam.manager.displayName}
                          </span>
                          <span className="font-mono">{t.score?.toFixed(1) ?? "—"}</span>
                        </div>
                      ))}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Separator className="my-8" />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="uppercase">Draft Summary</CardTitle>
          </CardHeader>
          <CardContent>
            {draft ? (
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">
                  {draft.rounds} rounds · {draft.picks.length} picks
                </p>
                <p className="mt-2 font-medium">Round 1</p>
                {draft.picks
                  .filter((p) => p.round === 1)
                  .map((p) => (
                    <div key={p.id} className="flex justify-between text-muted-foreground">
                      <span>
                        {p.pickNumber}. {p.manager?.displayName}
                      </span>
                      <span>
                        {p.player ? `${p.player.firstName} ${p.player.lastName}` : "—"}
                      </span>
                    </div>
                  ))}
                <Link href="/drafts" className="mt-2 inline-block text-primary hover:underline">
                  View full draft board →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No draft recorded for this season.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="uppercase">Highest Scorer</CardTitle>
          </CardHeader>
          <CardContent>
            {highestScore ? (
              <p className="text-sm">
                <strong>
                  {highestScore.player.firstName} {highestScore.player.lastName}
                </strong>{" "}
                dropped <strong className="font-mono">{(highestScore.points ?? 0).toFixed(1)}</strong> points
                for {highestScore.roster.fantasyTeam.manager.displayName} in Week {highestScore.roster.week}.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No scoring data yet.</p>
            )}
          </CardContent>
        </Card>

        {/*
         * Trades came from the `isNotable` flag, which nothing ever set, so a
         * season with six verified trades — two of them outright fleecings —
         * reported "no notable trades flagged for this season yet". It now
         * reads the Tribunal's own verdicts, which are computed from results.
         */}
        <Card>
          <CardHeader>
            <CardTitle className="uppercase">Trades</CardTitle>
          </CardHeader>
          <CardContent>
            {seasonTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No trades are on record for this season.
                {season.dataSource === "ESPN"
                  ? " ESPN does not retain transaction history for archived seasons, so this is a gap in the data rather than a quiet year."
                  : ""}
              </p>
            ) : (
              <div className="space-y-3">
                <p className="text-sm">
                  <strong className="font-mono">{seasonTrades.length}</strong> trade
                  {seasonTrades.length === 1 ? "" : "s"} on record
                  {biggestTrade?.lopsidedness && biggestTrade.lopsidedness !== "EVEN_DEAL"
                    ? `, the most one-sided judged ${LOPSIDEDNESS_LABEL[biggestTrade.lopsidedness].toLowerCase()}.`
                    : ", none of them one-sided."}
                </p>
                {biggestTrade && biggestTrade.lopsidedness !== "EVEN_DEAL" ? (
                  <p className="text-sm text-muted-foreground">
                    Week {biggestTrade.week}: {biggestTrade.hindsightSummary}.
                  </p>
                ) : null}
                <Link href="/trade-tribunal" className="inline-block text-sm text-primary hover:underline">
                  Every verdict in the Trade Tribunal →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {article ? (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 uppercase">
                <Sparkles className="h-4 w-4" /> {article.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-3xl space-y-4">
                {article.paragraphs.map((paragraph, i) => (
                  <p key={i} className="text-sm leading-relaxed text-foreground/90">
                    {paragraph}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
