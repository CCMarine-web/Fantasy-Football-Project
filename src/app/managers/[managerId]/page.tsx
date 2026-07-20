import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { ManagerTrajectoryChart } from "@/components/charts/manager-trajectory-chart";
import { getManagerProfileDetailed, getManagerScoutingReport } from "@/server/repositories/manager-repository";
import { getManagerAwardTally } from "@/server/repositories/weekly-awards-repository";
import { Quote, Sparkles, TrendingUp } from "lucide-react";

export const metadata = { title: "Manager Profile" };

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

const LUCK_STYLES: Record<string, string> = {
  lucky: "bg-field/15 text-field border-field/40",
  unlucky: "bg-destructive/15 text-destructive border-destructive/40",
  neutral: "bg-muted text-muted-foreground border-border/60",
};

export default async function ManagerProfilePage({
  params,
}: {
  params: Promise<{ managerId: string }>;
}) {
  const { managerId } = await params;
  const [profile, scouting, awardTally] = await Promise.all([
    getManagerProfileDetailed(managerId),
    getManagerScoutingReport(managerId),
    getManagerAwardTally(managerId),
  ]);
  if (!profile) notFound();

  const { manager, stats, seasonLines, bestSeason, worstSeason, finishDistribution, headToHead } = profile;
  const currentTeam = manager.fantasyTeams[manager.fantasyTeams.length - 1];
  const photo = manager.photoUrl ?? manager.avatarUrl;
  const teamCount = finishDistribution.length || 10;
  const trajectory = [...seasonLines]
    .filter((l) => l.finalRank != null)
    .map((l) => ({ year: l.year, finalRank: l.finalRank, teamCount }));
  const maxFinishCount = Math.max(1, ...finishDistribution.map((f) => f.count));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        {manager.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo ?? undefined} alt={manager.displayName} className="h-24 w-24 shrink-0 rounded-xl border border-border/60 object-cover" />
        ) : (
          <TeamAvatar name={manager.displayName} imageUrl={manager.avatarUrl} className="h-20 w-20" />
        )}
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            {currentTeam?.teamName ?? "Free Agent"}
          </p>
          <h1 className="font-heading text-3xl font-semibold uppercase sm:text-4xl">{manager.displayName}</h1>
          {manager.nickname ? (
            <p className="mt-1 text-sm text-primary">
              &ldquo;{manager.nickname}&rdquo;
              {manager.nicknameOrigin ? <span className="text-muted-foreground"> — {manager.nicknameOrigin}</span> : null}
            </p>
          ) : null}
          {manager.signatureMove ? (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Signature move:</span> {manager.signatureMove}
            </p>
          ) : null}
          {manager.bio ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{manager.bio}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.championships > 0 ? (
              <Badge className="bg-primary text-primary-foreground">{stats.championships}&times; Champion</Badge>
            ) : null}
            {stats.finalsAppearances > 0 ? (
              <Badge variant="secondary">{stats.finalsAppearances} Finals</Badge>
            ) : null}
            <Badge className={`border ${LUCK_STYLES[stats.luck.label]}`}>
              {stats.luck.label === "neutral"
                ? "Neutral luck"
                : `${stats.luck.label === "lucky" ? "Lucky" : "Unlucky"} (${stats.luck.delta > 0 ? "+" : ""}${(stats.luck.delta * 100).toFixed(0)}%)`}
            </Badge>
            {manager.noRoast ? <Badge variant="outline">No-Roast</Badge> : null}
          </div>
        </div>
      </div>

      <Separator className="my-8" />

      {/* Career headline stats */}
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Career</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Record"
            value={`${stats.record.wins}-${stats.record.losses}${stats.record.ties ? `-${stats.record.ties}` : ""}`}
            sub={`${(stats.winningPercentage * 100).toFixed(1)}% win rate`}
          />
          <StatTile
            label="All-Play Record"
            value={`${stats.allPlay.wins}-${stats.allPlay.losses}`}
            sub={`${(stats.allPlay.winPct * 100).toFixed(1)}% vs the field`}
          />
          <StatTile label="Championships" value={stats.championships} sub={`${stats.playoffAppearances} playoff appearances`} />
          <StatTile label="Avg. Finish" value={stats.averageFinish || "—"} />
          <StatTile label="Total PF" value={stats.totalPointsFor.toFixed(0)} sub={`${stats.totalPointsAgainst.toFixed(0)} against`} />
          <StatTile label="High / Low Game" value={`${stats.highestWeeklyScore?.toFixed(0) ?? "—"} / ${stats.lowestWeeklyScore?.toFixed(0) ?? "—"}`} />
          <StatTile label="Longest W / L Streak" value={`${stats.longestWinningStreak}W / ${stats.longestLosingStreak}L`} />
          <StatTile
            label="Avg Margin (W / L)"
            value={`+${stats.avgMarginVictory.toFixed(0)} / -${stats.avgMarginDefeat.toFixed(0)}`}
          />
        </div>
      </section>

      {/* Best/worst season + close/blowout */}
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatTile
          label="Best Season"
          value={bestSeason ? String(bestSeason.year) : "—"}
          sub={bestSeason ? `${bestSeason.wins}-${bestSeason.losses}, ${bestSeason.pointsFor.toFixed(0)} PF` : undefined}
        />
        <StatTile
          label="Worst Season"
          value={worstSeason ? String(worstSeason.year) : "—"}
          sub={worstSeason ? `${worstSeason.wins}-${worstSeason.losses}, ${worstSeason.pointsFor.toFixed(0)} PF` : undefined}
        />
        <StatTile label="Close Games (<5)" value={`${stats.closeRecord.wins}-${stats.closeRecord.losses}`} />
        <StatTile label="Blowouts (≥40)" value={`${stats.blowoutRecord.wins}-${stats.blowoutRecord.losses}`} />
      </div>

      <Separator className="my-8" />

      {/* Season-by-season + trajectory */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Season by Season</h2>
          {seasonLines.length === 0 ? (
            <EmptyState title="No seasons played yet" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">Year</th>
                    <th className="px-3 py-2 text-right">W-L</th>
                    <th className="px-3 py-2 text-right">PF</th>
                    <th className="px-3 py-2 text-right">PA</th>
                    <th className="px-3 py-2 text-right">Finish</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {[...seasonLines].reverse().map((l) => (
                    <tr key={l.year}>
                      <td className="px-3 py-2 font-medium">{l.year}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {l.wins}-{l.losses}
                        {l.ties ? `-${l.ties}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{l.pointsFor.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">{l.pointsAgainst.toFixed(0)}</td>
                      <td className="px-3 py-2 text-right">
                        {l.isChampion ? (
                          <Badge className="bg-primary text-primary-foreground">Champ</Badge>
                        ) : l.finalRank ? (
                          <span className="font-mono">#{l.finalRank}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
            <TrendingUp className="h-4 w-4" /> Career Trajectory
          </h2>
          <Card>
            <CardContent>
              {trajectory.length > 0 ? (
                <ManagerTrajectoryChart data={trajectory} />
              ) : (
                <EmptyState title="No completed seasons yet" />
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <Separator className="my-8" />

      {/* Weekly finish distribution */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
          Weekly Finish Distribution
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          How often this manager posted the Nth-best score in the league across every week played.
        </p>
        <div className="flex items-end gap-1.5 sm:gap-2">
          {finishDistribution.map((f) => (
            <div key={f.finish} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[11px] text-muted-foreground">{f.count}</span>
              <div className="flex h-28 w-full items-end">
                <div
                  className={`w-full rounded-t ${f.finish === 1 ? "bg-primary" : "bg-primary/40"}`}
                  style={{ height: `${(f.count / maxFinishCount) * 100}%`, minHeight: f.count ? "4px" : "0" }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground">{f.finish}</span>
            </div>
          ))}
        </div>
      </section>

      <Separator className="my-8" />

      {/* Head-to-head vs everyone */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Head-to-Head</h2>
        {headToHead.length === 0 ? (
          <EmptyState title="No head-to-head games yet" />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {headToHead.map((h) => {
              const total = h.wins + h.losses + h.ties;
              const winning = h.wins > h.losses;
              const losing = h.wins < h.losses;
              return (
                <Link
                  key={h.opponentId}
                  href={`/managers/${h.opponentId}`}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm transition-colors hover:border-primary/60"
                >
                  <span className="truncate">{h.opponentName}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{total}g</span>
                    <span
                      className={`font-mono font-semibold ${winning ? "text-field" : losing ? "text-destructive" : ""}`}
                    >
                      {h.wins}-{h.losses}
                      {h.ties ? `-${h.ties}` : ""}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <Separator className="my-8" />

      {/* Team name history */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Team Name History</h2>
        <div className="flex flex-wrap gap-2">
          {manager.teamNameHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground">No name changes on record.</p>
          ) : (
            manager.teamNameHistory.map((h) => (
              <Badge key={h.id} variant="outline">
                {h.seasonYear}: {h.name}
              </Badge>
            ))
          )}
        </div>
      </section>

      {/* Weekly award tally */}
      {awardTally.length > 0 ? (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
              Weekly Award Tally
            </h2>
            <div className="flex flex-wrap gap-2">
              {awardTally.map((a) => (
                <Badge key={a.type} variant="secondary">
                  {a.label}: {a.count}
                </Badge>
              ))}
            </div>
          </section>
        </>
      ) : null}

      <Separator className="my-8" />

      {/* AI scouting report + quotes */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Sparkles className="h-4 w-4" /> Scouting Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scouting ? (
              <>
                <p className="text-sm whitespace-pre-line text-foreground/90">{scouting.text}</p>
                {scouting.isMock ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Placeholder — add an <code>OPENAI_API_KEY</code> for a real scouting report.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                A generated scouting report — draft tendencies, trade behavior, and archetype — will
                appear here once this manager has enough history.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Quote className="h-4 w-4" /> Famous Quotes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Quotes pulled from approved group-chat history will appear here once chat-lore import is
              complete for this manager.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
