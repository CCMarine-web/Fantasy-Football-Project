import { prisma } from "@/lib/db";
import { renderAtRequestIfNoDatabase, staticParamsOrEmpty } from "@/server/build-guard";
import { DataFreshness } from "@/components/shared/data-freshness";
import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart, SimpleBars } from "@/components/charts/charts";
import { managerPath } from "@/lib/slug";
import { permanentRedirect } from "next/navigation";
import { allManagerSlugs, resolveManagerParam } from "@/server/repositories/manager-slug";
import { AiText } from "@/components/shared/ai-text";
import { managerBioTexts, scoutingText } from "@/server/text/page-texts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/lib/branding";
import { BrandArt } from "@/components/shared/brand-art";
import { managerSlotKey } from "@/lib/brand-assets";
import { LuckScoreHeadline, LuckScorePanel } from "@/components/managers/luck-score";
import { LAST_PLACE_METHODOLOGY } from "@/server/stats/last-place";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import {
  getManagerProfileDetailed,
} from "@/server/repositories/manager-repository";
import { getManagerAwardTally } from "@/server/repositories/weekly-awards-repository";
import { Sparkles } from "lucide-react";

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

/** Rendered on first request, then served from the ISR cache until the pipeline revalidates it. */
export async function generateStaticParams() {
  return staticParamsOrEmpty(async () => (await allManagerSlugs()).map((managerId) => ({ managerId })));
}

/**
 * Manager-specific page metadata. A shared "Manager Profile" title made every
 * one of these pages indistinguishable in a browser tab, a bookmark list and a
 * search result.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ managerId: string }>;
}): Promise<Metadata> {
  const { managerId: param } = await params;
  const resolved = await resolveManagerParam(param);
  const profile = resolved ? await getManagerProfileDetailed(resolved.id) : null;
  if (!profile) return { title: "Manager Profile" };

  const { manager, stats, eraStats, seasonLines } = profile;
  const career = eraStats.find((e) => e.key === "CAREER");
  const played = seasonLines.filter((l) => l.wins + l.losses + l.ties > 0);
  const years = played.map((l) => l.year).sort((a, b) => a - b);
  const span = years.length
    ? years[0] === years[years.length - 1]
      ? `${years[0]}`
      : `${years[0]}–${years[years.length - 1]}`
    : null;

  const facts = [
    span ? `${span}` : null,
    career ? `${career.wins}-${career.losses}${career.ties ? `-${career.ties}` : ""} in the regular season` : null,
    stats.championships > 0
      ? `${stats.championships} championship${stats.championships === 1 ? "" : "s"}`
      : "no titles yet",
  ].filter(Boolean);

  return {
    title: `${manager.displayName} — Manager Profile`,
    description: `${manager.displayName} in ${BRAND.longName}: ${facts.join(", ")}. Career and season-by-season statistics, head-to-head records, Luck Score, and a full written profile.`,
  };
}

function StatTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export default async function ManagerProfilePage({
  params,
}: {
  params: Promise<{ managerId: string }>;
}) {
  // Pre-rendered when the build can reach the database; otherwise rendered per request.
  await renderAtRequestIfNoDatabase();
  const { managerId: param } = await params;
  const resolved = await resolveManagerParam(param);
  if (!resolved) notFound();
  // Old id URLs (shared before readable slugs) move permanently to the slug.
  if (resolved.isLegacyId) permanentRedirect(`/managers/${resolved.slug}`);
  const managerId = resolved.id;
  const [profile, awardTally, bios] = await Promise.all([
    getManagerProfileDetailed(managerId),
    getManagerAwardTally(managerId),
    managerBioTexts(),
  ]);
  if (!profile) notFound();
  const bio = bios.get(managerId) ?? null;
  const leagueTeams = await prisma.fantasyTeam.findMany({
    where: { season: { status: { not: "UPCOMING" } } },
    select: { pointsFor: true, wins: true, losses: true, ties: true, season: { select: { year: true } } },
  });
  const leaguePpg = new Map<number, number>();
  for (const year of new Set(leagueTeams.map((t) => t.season.year))) {
    const ts = leagueTeams.filter((t) => t.season.year === year && t.wins + t.losses + t.ties > 0);
    const pf = ts.reduce((s, t) => s + t.pointsFor, 0);
    const g = ts.reduce((s, t) => s + t.wins + t.losses + t.ties, 0);
    if (g) leaguePpg.set(year, pf / g);
  }
  const scouting = await scoutingText(managerId, profile.manager.displayName);

  const {
    manager,
    stats,
    seasonLines,
    eraStats,
    luck,
    lastPlaceYears,
    teamNameRuns,
    bestSeason,
    worstSeason,
    finishDistribution,
    headToHead,
  } = profile;
  const currentTeam = manager.fantasyTeams[manager.fantasyTeams.length - 1];
  const photo = manager.photoUrl ?? manager.avatarUrl;
  const teamCount = finishDistribution.length || 10;
  const maxFinishCount = Math.max(1, ...finishDistribution.map((f) => f.count));
  const trajectoryData = seasonLines
    .filter((l) => l.finalRank != null || l.regularSeasonRank != null)
    .map((l) => ({ season: l.year, regular: l.regularSeasonRank, final: l.finalRank, champion: l.isChampion }));
  const ppgVsLeague = seasonLines
    .filter((l) => l.wins + l.losses + l.ties > 0 && leaguePpg.has(l.year))
    .map((l) => {
      const ppg = l.pointsFor / (l.wins + l.losses + l.ties);
      const league = leaguePpg.get(l.year) as number;
      return { label: String(l.year), value: Math.round(((ppg - league) / league) * 1000) / 10, ppg, league };
    });
  const hasBiography = !!(manager.bio || manager.nicknameOrigin || manager.signatureMove);
  const profileParagraphs = bio ? [bio.text] : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header — identity only. Statistics come first, the biography follows. */}
      <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
        {/* The trading card once it has been drawn; the photo until then. */}
        <BrandArt
          slot={managerSlotKey("card", manager.displayName)}
          alt={`${manager.displayName} trading card`}
          eager
          sizes="160px"
          className="h-56 w-40 shrink-0 rounded-xl border border-border/60 object-cover shadow-lg"
          fallback={
            manager.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo ?? undefined} alt={manager.displayName} className="h-24 w-24 shrink-0 rounded-xl border border-border/60 object-cover" />
            ) : (
              <TeamAvatar name={manager.displayName} imageUrl={manager.photoUrl ?? manager.avatarUrl} className="h-20 w-20 shrink-0" />
            )
          }
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            {currentTeam?.teamName ?? "Free Agent"}
          </p>
          <h1 className="font-heading text-3xl font-semibold break-words uppercase sm:text-4xl">{manager.displayName}</h1>
          {manager.nickname ? <p className="mt-1 text-sm text-primary">&ldquo;{manager.nickname}&rdquo;</p> : null}
          <DataFreshness className="mt-2" />
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.championships > 0 ? (
              <Badge className="bg-primary text-primary-foreground">{stats.championships}&times; Champion</Badge>
            ) : null}
            {stats.finalsAppearances > 0 ? (
              <Badge variant="secondary">{stats.finalsAppearances} Finals</Badge>
            ) : null}
            {lastPlaceYears.length > 0 ? (
              <Badge
                variant="outline"
                className="text-destructive"
                title={`Finished bottom of the regular-season standings in ${lastPlaceYears.join(", ")}. ${LAST_PLACE_METHODOLOGY}`}
              >
                {lastPlaceYears.length}&times; Last Place
              </Badge>
            ) : null}
            {!manager.isActive ? <Badge variant="outline">Retired</Badge> : null}
            {manager.noRoast ? <Badge variant="outline">No-Roast</Badge> : null}
          </div>
        </div>

        {/* The Luck Score sits beside the name, as a number and its label, so a
            reader meets it before the tables rather than three sections down. */}
        {luck.career ? (
          <div className="w-full sm:ml-auto sm:w-auto sm:min-w-56">
            <LuckScoreHeadline
              luck={luck.career}
              seasonLuck={luck.season}
              seasonYear={luck.seasonYear}
            />
          </div>
        ) : null}
      </div>

      <Separator className="my-8" />

      {/* Career / era breakdown — the headline table. */}
      <section>
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Career Statistics</h2>
        <p className="mt-1 mb-4 max-w-prose text-sm leading-relaxed text-muted-foreground">
          The league ran on ESPN through 2022 and on Sleeper from 2023. Both eras are counted in the
          career totals. <strong className="text-foreground">Record</strong> is the regular season
          only, so it matches the season-by-season table below.{" "}
          <strong className="text-foreground">Playoffs</strong> counts championship-bracket games —
          the ones that decide the title — and nothing else. Consolation-bracket games are not
          counted anywhere on this page. Points per game is the fair comparison between eras of
          different lengths.
        </p>
        {/* Eleven columns cannot fit a phone, and dropping any of them would
            defeat the point of the table, so this one genuinely scrolls. The
            note below is the affordance — without it a phone user sees a
            column sliced at the right edge and reads it as a bug. */}
        <p className="mb-2 text-xs text-muted-foreground sm:hidden" aria-hidden>
          Swipe the table sideways to see every column →
        </p>
        <div className="relative overflow-x-auto rounded-lg border border-border/60">
          <table className="w-full min-w-[56rem] text-sm">
            <caption className="sr-only">Career, ESPN-era and Sleeper-era statistics</caption>
            <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                {/* Sticky first column: this table is twelve columns wide and
                    genuinely has to scroll on a phone, and without an anchor a
                    reader scrolling right loses track of which era's row they
                    are reading. */}
                <th
                  scope="col"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left"
                >
                  Era
                </th>
                <th scope="col" className="px-3 py-2 text-left">Years</th>
                <th scope="col" className="px-3 py-2 text-right">Seasons</th>
                <th scope="col" className="px-3 py-2 text-right" title="Regular-season record">Record</th>
                <th scope="col" className="px-3 py-2 text-right">Win%</th>
                <th
                  scope="col"
                  className="px-3 py-2 text-right"
                  title="Championship-bracket record — the games that decide the title. Consolation games are not counted."
                >
                  Playoffs
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
                  {/* Opaque, not the row's translucent tint — a sticky cell
                      with a see-through background shows the scrolled columns
                      sliding underneath it. */}
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 px-3 py-2 text-left font-medium ${
                      era.key === "CAREER" ? "bg-card" : "bg-background"
                    }`}
                  >
                    {era.label}
                  </th>
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

      {/* Luck Score — deterministic, computed from recorded scores. */}
      {luck.career ? (
        <section className="mt-8">
          <LuckScorePanel career={luck.career} season={luck.season} seasonYear={luck.seasonYear} />
        </section>
      ) : null}

      {/* Career headline stats */}
      <section className="mt-8">
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Career Highs &amp; Splits</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          All-play, margins, close games and blowouts are regular season only. Highs, lows and points
          totals count every game played, postseason included — a career-best score is a career-best
          score wherever it happened.
        </p>
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
      <div className="grid grid-cols-1 gap-8">
        <section>
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Season by Season</h2>
          {seasonLines.length === 0 ? (
            <EmptyState title="No seasons played yet" />
          ) : (
            <div className="relative overflow-x-auto rounded-lg border border-border/60">
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

        {trajectoryData.length > 0 ? (
          <ChartFrame
            title="Career trajectory"
            caption="Regular-season finish (dashed) and final finish (solid) each completed season. 1 is the top; gold dots are title years."
            summary={`${manager.displayName}'s regular-season and final finish in each completed season.`}
            table={{ headers: ["Season", "Regular season", "Final"], rows: trajectoryData.map((d) => [d.season, d.regular ?? "—", d.final ?? "—"]) }}
          >
            <MultiLineChart
              data={trajectoryData}
              xKey="season"
              xLabel="Season"
              yLabel="Finish"
              reversedY
              yDomain={[1, teamCount]}
              yTicks={Array.from({ length: teamCount }, (_, i) => i + 1)}
              tooltipFormat="rank"
              series={[
                { key: "regular", label: "Regular-season finish", color: "var(--muted-foreground)", dashed: true },
                { key: "final", label: "Final finish", color: "var(--primary)", highlight: trajectoryData.filter((d) => d.champion).map((d) => ({ x: d.season, color: "#F0E442", label: `${d.season} champion` })) },
              ]}
            />
          </ChartFrame>
        ) : null}

        {ppgVsLeague.length > 0 ? (
          <ChartFrame
            title="Scoring vs. the league, by season"
            caption="Points per game compared with that season's league average — raw totals aren't comparable across eras and rule changes."
            summary={`How far above or below the league's average points per game ${manager.displayName} scored in each season.`}
            table={{ headers: ["Season", "PPG", "League PPG", "Difference %"], rows: ppgVsLeague.map((d) => [d.label, d.ppg.toFixed(1), d.league.toFixed(1), `${d.value.toFixed(1)}%`]) }}
            height="h-64"
          >
            <SimpleBars data={ppgVsLeague} valueLabel="% vs league average" diverging valueFormat="pct0" />
          </ChartFrame>
        ) : null}
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
          <ul className="space-y-1.5" aria-label="Head-to-head win percentage against each opponent">
            {[...headToHead]
              .sort((x, y) => y.wins / y.games - x.wins / x.games || y.games - x.games)
              .map((h) => {
                const pct = ((h.wins + 0.5 * h.ties) / h.games) * 100;
                return (
                  <li key={h.opponentId}>
                    <Link href={managerPath(h.opponentName)} className="grid grid-cols-[7.5rem_1fr_4.5rem] items-center gap-2 text-sm hover:text-primary sm:grid-cols-[11rem_1fr_6rem]">
                      <span className="truncate font-medium">{h.opponentName}</span>
                      <span className="relative h-4 rounded bg-muted/40" title={`${pct.toFixed(0)}% over ${h.games} meetings · ${h.pointsForAvg} scored, ${h.pointsAgainstAvg} allowed per game`}>
                        <span className="absolute inset-y-0 left-0 rounded" style={{ width: `${pct}%`, background: pct >= 50 ? "#3DD68C" : "#FF6369" }} />
                        <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/50" aria-hidden />
                      </span>
                      <span className="text-right font-mono tabular-nums">
                        {h.wins}-{h.losses}
                        {h.ties ? `-${h.ties}` : ""} <span className="text-xs text-muted-foreground">({h.games})</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </section>

      <Separator className="my-8" />

      {/* Team name history */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Team Name History</h2>
        {/*
         * Consecutive seasons under the same name are collapsed into one entry.
         * The old list printed a badge per season, so six years of "Team I am
         * Messi" rendered as six identical badges running into each other, and
         * it covered only the ESPN era because that is all TeamNameHistory
         * holds. This reads from the season rows instead, so every year is
         * present and each name appears once per spell.
         */}
        {teamNameRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No team names on record.</p>
        ) : (
          <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
            {teamNameRuns.map((run) => (
              <li
                key={`${run.name}-${run.firstYear}`}
                className="flex items-baseline justify-between gap-4 px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-words font-medium">{run.name}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{run.years}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Weekly award tally */}
      {awardTally.length > 0 ? (
        <>
          <Separator className="my-8" />
          <section>
            <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
              Weekly Award Tally
            </h2>
            <ul className="max-w-xl space-y-1.5">
              {awardTally.map((a) => (
                <li key={a.type} className="grid grid-cols-[9.5rem_1fr_2rem] items-center gap-2 text-sm">
                  <span className="truncate">{a.label}</span>
                  <span className="h-3 rounded bg-muted/40">
                    <span className="block h-3 rounded bg-primary" style={{ width: `${(a.count / Math.max(...awardTally.map((x) => x.count))) * 100}%` }} />
                  </span>
                  <span className="text-right font-mono tabular-nums">{a.count}</span>
                </li>
              ))}
            </ul>
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
        {bio ? <AiText text={bio} className="mb-4" /> : null}

        {/*
         * The commissioner's hand-written notes, if any. The "No biography yet"
         * empty state that used to sit here was shown even when the written
         * career profile above filled the whole section, so the page said it
         * had no biography directly underneath several hundred words of one.
         * It now appears only when there is genuinely nothing.
         */}
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
        ) : profileParagraphs.length === 0 ? (
          <EmptyState title="No biography yet" description="A commissioner can add one from the admin manager editor." />
        ) : null}
      </section>

      <Separator className="my-8" />

      {/*
        The "Famous Quotes" card has been removed. It was a permanent empty
        state promising quotes from the group-chat archive, which is admin-only
        and deliberately never published — so it advertised something that was
        never going to appear.
      */}
      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Sparkles className="h-4 w-4" /> Scouting Report
            </CardTitle>
          </CardHeader>
          <CardContent>
            {scouting ? (
              <AiText text={scouting} />
            ) : (
              <p className="text-sm text-muted-foreground">
                A generated scouting report — draft tendencies, trade behavior, and archetype — will
                appear here once this manager has enough history.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
