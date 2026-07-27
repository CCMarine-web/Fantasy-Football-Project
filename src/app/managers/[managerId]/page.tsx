import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { ManagerTrajectoryChart } from "@/components/charts/manager-trajectory-chart";
import {
  getManagerProfileDetailed,
  getManagerScoutingReport,
  getOrCreateManagerPerformanceSummary,
} from "@/server/repositories/manager-repository";
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
  const [profile, scouting, awardTally, performance] = await Promise.all([
    getManagerProfileDetailed(managerId),
    getManagerScoutingReport(managerId),
    getManagerAwardTally(managerId),
    getOrCreateManagerPerformanceSummary(managerId),
  ]);
  if (!profile) notFound();

  const { manager, stats, seasonLines, eraStats, bestSeason, worstSeason, finishDistribution, headToHead } = profile;
  const currentTeam = manager.fantasyTeams[manager.fantasyTeams.length - 1];
  const photo = manager.photoUrl ?? manager.avatarUrl;
  const teamCount = finishDistribution.length || 10;
  const trajectory = [...seasonLines]
    .filter((l) => l.finalRank != null)
    .map((l) => ({ year: l.year, finalRank: l.finalRank, teamCount }));
  const maxFinishCount = Math.max(1, ...finishDistribution.map((f) => f.count));
  const hasBiography = !!(manager.bio || manager.nicknameOrigin || manager.signatureMove);
  // Placeholder text is never shown as if it were a real profile.
  const profileParagraphs =
    performance && !performance.isMock
      ? performance.text
          .split(/\n\s*\n/)
          .map((paragraph) => paragraph.trim())
          .filter(Boolean)
      : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header — identity only. Statistics come first, the biography follows. */}
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
        {manager.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo ?? undefined} alt={manager.displayName} className="h-24 w-24 shrink-0 rounded-xl border border-border/60 object-cover" />
        ) : (
          <TeamAvatar name={manager.displayName} imageUrl={manager.avatarUrl} className="h-20 w-20 shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            {currentTeam?.teamName ?? "Free Agent"}
          </p>
          <h1 className="font-heading text-3xl font-semibold break-words uppercase sm:text-4xl">{manager.displayName}</h1>
          {manager.nickname ? <p className="mt-1 text-sm text-primary">&ldquo;{manager.nickname}&rdquo;</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.championships > 0 ? (
              <Badge className="bg-primary text-primary-foreground">{stats.championships}&times; Champion</Badge>
            ) : null}
            {stats.finalsAppearances > 0 ? (
              <Badge variant="secondary">{stats.finalsAppearances} Finals</Badge>
            ) : null}
            {!manager.isActive ? <Badge variant="outline">Retired</Badge> : null}
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

      {/* Career / era breakdown — the headline table. */}
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Career Statistics</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          The league ran on ESPN through 2022 and on Sleeper from 2023. Both eras are counted in the
          career totals. Records are regular season, so they match the season-by-season table below;
          postseason games are listed separately, and points per game is the fair comparison between
          eras of different lengths.
        </p>
        {/* Eleven columns cannot fit a phone, and dropping any of them would
            defeat the point of the table, so this one genuinely scrolls. The
            note below is the affordance — without it a phone user sees a
            column sliced at the right edge and reads it as a bug. */}
        <p className="mb-2 text-xs text-muted-foreground sm:hidden" aria-hidden>
          Swipe the table sideways to see every column →
        </p>
        <div className="overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">Career, ESPN-era and Sleeper-era statistics</caption>
            <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">Era</th>
                <th scope="col" className="px-3 py-2 text-left">Years</th>
                <th scope="col" className="px-3 py-2 text-right">Seasons</th>
                <th scope="col" className="px-3 py-2 text-right" title="Regular-season record">Record</th>
                <th scope="col" className="px-3 py-2 text-right">Win%</th>
                <th scope="col" className="px-3 py-2 text-right" title="Postseason record, consolation-bracket games included">
                  Postseason
                </th>
                <th scope="col" className="px-3 py-2 text-right">PF/G</th>
                <th scope="col" className="px-3 py-2 text-right">PA/G</th>
                <th scope="col" className="px-3 py-2 text-right">Titles</th>
                <th scope="col" className="px-3 py-2 text-right" title="Seasons in which this manager reached the playoffs">
                  Berths
                </th>
                <th scope="col" className="px-3 py-2 text-right" title="Best final standing on record. Sleeper only reports a final placing for the top three, so a finish outside the podium shows as —.">
                  Best
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {eraStats.map((era) => (
                <tr key={era.key} className={era.key === "CAREER" ? "bg-card/30 font-semibold" : undefined}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">{era.label}</th>
                  <td className="px-3 py-2 text-muted-foreground">{era.years}</td>
                  <td className="px-3 py-2 text-right font-mono">{era.seasonsPlayed}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {era.wins}-{era.losses}
                    {era.ties ? `-${era.ties}` : ""}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{(era.winningPercentage * 100).toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {era.playoffWins + era.playoffLosses > 0 ? `${era.playoffWins}-${era.playoffLosses}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{era.pointsForPerGame?.toFixed(1) ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                    {era.pointsAgainstPerGame?.toFixed(1) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{era.championships}</td>
                  <td className="px-3 py-2 text-right font-mono">{era.playoffAppearances}</td>
                  <td className="px-3 py-2 text-right font-mono">{era.bestFinish ? `#${era.bestFinish}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Career headline stats */}
      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Career Highs &amp; Splits</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="All-Play Record"
            value={`${stats.allPlay.wins}-${stats.allPlay.losses}`}
            sub={`${(stats.allPlay.winPct * 100).toFixed(1)}% vs the field`}
          />
          <StatTile label="Avg. Finish" value={stats.averageFinish || "—"} />
          <StatTile label="Total PF" value={stats.totalPointsFor.toFixed(0)} sub={`${stats.totalPointsAgainst.toFixed(0)} against`} />
          <StatTile label="High / Low Game" value={`${stats.highestWeeklyScore?.toFixed(0) ?? "—"} / ${stats.lowestWeeklyScore?.toFixed(0) ?? "—"}`} />
          <StatTile label="Longest W / L Streak" value={`${stats.longestWinningStreak}W / ${stats.longestLosingStreak}L`} />
          <StatTile
            label="Avg Margin (W / L)"
            value={`+${stats.avgMarginVictory.toFixed(0)} / -${stats.avgMarginDefeat.toFixed(0)}`}
          />
          <StatTile label="Close Games (<5)" value={`${stats.closeRecord.wins}-${stats.closeRecord.losses}`} />
          <StatTile label="Blowouts (≥40)" value={`${stats.blowoutRecord.wins}-${stats.blowoutRecord.losses}`} />
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
        </div>
      </section>

      <Separator className="my-8" />

      {/* Season-by-season + trajectory */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Season by Season</h2>
          {seasonLines.length === 0 ? (
            <EmptyState title="No seasons played yet" />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/60">
              {/* No min-width: with PA hidden below `sm` the five remaining
                  columns fit a phone, and a 24rem floor was itself forcing a
                  28px overflow on a 356px container. */}
              <table className="w-full text-sm">
                <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th scope="col" className="px-2 py-2 sm:px-3 text-left">Year</th>
                    {/* Era and PA are the least-cited columns, so they are the
                        ones that step aside on a phone rather than the table
                        clipping a number in half. */}
                    <th scope="col" className="hidden px-2 py-2 text-left sm:table-cell sm:px-3">Era</th>
                    <th scope="col" className="px-2 py-2 sm:px-3 text-right">W-L</th>
                    <th scope="col" className="px-2 py-2 sm:px-3 text-right">PF</th>
                    <th scope="col" className="hidden px-2 py-2 text-right sm:table-cell sm:px-3">PA</th>
                    {/* Two separate columns: where the team finished the regular
                        season, and where it finished the season overall. They
                        are different facts and a single "Finish" column was
                        ambiguous about which one it meant. */}
                    <th scope="col" className="px-2 py-2 text-right sm:px-3" title="Regular-season standing">
                      Reg.
                    </th>
                    <th scope="col" className="px-2 py-2 text-right sm:px-3" title="Final placing after the postseason">
                      Final
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {[...seasonLines].reverse().map((l) => (
                    <tr key={l.year}>
                      <th scope="row" className="px-2 py-2 sm:px-3 text-left font-medium">{l.year}</th>
                      <td className="hidden px-2 py-2 text-xs text-muted-foreground sm:table-cell sm:px-3">
                        {l.dataSource === "ESPN" ? "ESPN" : l.dataSource === "SLEEPER" ? "Sleeper" : "Manual"}
                      </td>
                      <td className="px-2 py-2 sm:px-3 text-right font-mono">
                        {l.wins}-{l.losses}
                        {l.ties ? `-${l.ties}` : ""}
                      </td>
                      <td className="px-2 py-2 sm:px-3 text-right font-mono">{l.pointsFor.toFixed(0)}</td>
                      <td className="hidden px-2 py-2 text-right font-mono text-muted-foreground sm:table-cell sm:px-3">
                        {l.pointsAgainst.toFixed(0)}
                      </td>
                      <td className="px-2 py-2 text-right font-mono sm:px-3">
                        {l.regularSeasonRank ? `#${l.regularSeasonRank}` : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-2 text-right sm:px-3">
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
              <span className="font-mono text-[13px] text-muted-foreground">{f.count}</span>
              <div className="flex h-28 w-full items-end">
                <div
                  className={`w-full rounded-t ${f.finish === 1 ? "bg-primary" : "bg-primary/40"}`}
                  style={{ height: `${(f.count / maxFinishCount) * 100}%`, minHeight: f.count ? "4px" : "0" }}
                />
              </div>
              <span className="text-[13px] text-muted-foreground">{f.finish}</span>
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

      {/* Biography — deliberately below the statistics tables. */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Biography</h2>

        {/* The written career profile, generated once from the verified record
            and saved. Rendered as real paragraphs — it is several hundred
            words, not the couple of sentences it used to be. */}
        {profileParagraphs.length > 0 ? (
          <div className="mb-4 space-y-4">
            {profileParagraphs.map((paragraph, i) => (
              <p key={i} className="text-sm leading-relaxed text-foreground/90">
                {paragraph}
              </p>
            ))}
          </div>
        ) : null}

        {hasBiography ? (
          <div className="space-y-3 rounded-lg border border-border/60 bg-card/30 p-4">
            {manager.bio ? <p className="text-sm leading-relaxed text-foreground/90">{manager.bio}</p> : null}
            {manager.nickname && manager.nicknameOrigin ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Nickname:</span> &ldquo;{manager.nickname}&rdquo; —{" "}
                {manager.nicknameOrigin}
              </p>
            ) : null}
            {manager.signatureMove ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">Signature move:</span> {manager.signatureMove}
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No biography yet" description="A commissioner can add one from the admin manager editor." />
        )}
      </section>

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
