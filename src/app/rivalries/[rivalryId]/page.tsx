import Link from "next/link";
import { managerPath } from "@/lib/slug";
import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart, SimpleBars } from "@/components/charts/charts";
import { AiText } from "@/components/shared/ai-text";
import { rivalryTexts } from "@/server/text/page-texts";
import { SERIES_DEFINITION } from "@/server/stats/head-to-head";
import { notFound, permanentRedirect } from "next/navigation";
import { resolveRivalrySlugParam } from "@/server/repositories/rivalry-slug";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getRivalryDetail,
  type RivalryMeetingView,
} from "@/server/repositories/computed-rivalries-repository";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

/** Rendered on first request, then served from the ISR cache until the pipeline revalidates it. */
export async function generateStaticParams() {
  return [];
}

/**
 * The [rivalryId] segment is a readable slug ("gavin-detillier-vs-anthony-cibilich",
 * managers in the stored A/B order). An old opaque id, or the pair named the
 * other way round, still resolves — the page redirects it to the slug.
 */
export async function generateMetadata({ params }: { params: Promise<{ rivalryId: string }> }) {
  const { rivalryId: param } = await params;
  const resolved = await resolveRivalrySlugParam(param);
  const r = resolved ? await getRivalryDetail(resolved.id) : null;
  return { title: r ? `${r.managerAName} vs ${r.managerBName}` : "Rivalry" };
}

/**
 * Margins print to one decimal, like every other score on the site; one under
 * a point gets a second decimal so a real win never reads "0.0". `pts` is
 * singular at exactly one point.
 */
function formatMargin(v: number): string {
  return Math.abs(v) < 1 ? v.toFixed(2) : v.toFixed(1);
}

function marginPts(v: number): string {
  const n = formatMargin(v);
  return `${n} ${n === "1.0" ? "pt" : "pts"}`;
}

/**
 * Only the championship bracket earns a postseason badge. A "PO" beside a
 * placement game claimed a playoff meeting that never happened.
 */
function MeetingBadge({ m, className }: { m: RivalryMeetingView; className?: string }) {
  if (m.isChampionship) {
    return <Badge className={cn("bg-gold text-gold-foreground", className)}>Title</Badge>;
  }
  if (m.isPlayoff && m.bracketType === "WINNERS") {
    return (
      <Badge variant="outline" className={className}>
        PO
      </Badge>
    );
  }
  return null;
}

function Compare({
  label,
  a,
  b,
  format = (v: number) => String(v),
}: {
  label: string;
  a: number | null;
  b: number | null;
  format?: (v: number) => string;
}) {
  const aWins = a != null && b != null && a > b;
  const bWins = a != null && b != null && b > a;
  return (
    <div className="grid grid-cols-3 items-center gap-2 border-b border-border/50 py-2 last:border-0">
      <span className={`text-right font-mono text-sm tabular-nums ${aWins ? "font-semibold text-primary" : ""}`}>
        {a != null ? format(a) : "—"}
      </span>
      <span className="text-center text-xs tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${bWins ? "font-semibold text-primary" : ""}`}>
        {b != null ? format(b) : "—"}
      </span>
    </div>
  );
}

export default async function RivalryDetailPage({ params }: { params: Promise<{ rivalryId: string }> }) {
  // Pre-rendered when the build can reach the database; otherwise rendered per request.
  await renderAtRequestIfNoDatabase();
  const { rivalryId: param } = await params;
  const resolved = await resolveRivalrySlugParam(param);
  if (!resolved) notFound();
  // Old id URLs, and the pair named in reverse, move permanently to the slug.
  if (resolved.shouldRedirect) permanentRedirect(`/rivalries/${resolved.slug}`);
  const r = await getRivalryDetail(resolved.id);
  if (!r) notFound();
  const story = (await rivalryTexts([r])).get(r.id);

  const nameFor = (id: string | null) =>
    id === r.managerAId ? r.managerAName : id === r.managerBId ? r.managerBName : null;

  /*
   * Championship bracket only. A consolation meeting is a real game and stays
   * in the season-by-season log below, but it is not postseason history: the
   * teams in it were already eliminated, so listing it here under "Postseason
   * meetings" gave a placement game the weight of a semifinal.
   */
  const playoffMeetings = r.meetings.filter((m) => m.isPlayoff && m.bracketType === "WINNERS");
  // Charts: margin per meeting (A's side) and the running series, oldest first.
  // One accent for the first-named manager, neutral for the other (no team palette).
  const colorA = "var(--primary)";
  const colorB = "var(--muted-foreground)";
  const chrono = [...r.meetings].reverse();
  const running: { meeting: string; a: number; b: number }[] = [];
  for (const m of chrono) {
    const prev = running.at(-1) ?? { a: 0, b: 0 };
    running.push({
      meeting: `${String(m.seasonYear).slice(2)}·W${m.week}`,
      a: prev.a + (m.managerAScore > m.managerBScore ? 1 : 0),
      b: prev.b + (m.managerBScore > m.managerAScore ? 1 : 0),
    });
  }
  // Coloured by winner; championship-bracket games outlined.
  const marginBars = chrono.map((m) => ({
    label: `${String(m.seasonYear).slice(2)}·W${m.week}`,
    value: Math.round((m.managerAScore - m.managerBScore) * 10) / 10,
    color: m.managerAScore >= m.managerBScore ? colorA : colorB,
    outline: m.isPlayoff && m.bracketType === "WINNERS",
  }));
  // Season ticks only: the first meeting of each season carries the year.
  const seasonTicks: Record<string, string> = {};
  for (const m of chrono) {
    const key = `${String(m.seasonYear).slice(2)}·W${m.week}`;
    if (!Object.values(seasonTicks).includes(String(m.seasonYear))) seasonTicks[key] = String(m.seasonYear);
  }
  const aWinPct = r.gamesPlayed ? r.managerAWins / r.gamesPlayed : null;
  const bWinPct = r.gamesPlayed ? r.managerBWins / r.gamesPlayed : null;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader freshness
        eyebrow={r.isOfficial ? "Official rivalry" : "Head to head"}
        title={`${r.managerAName} vs ${r.managerBName}`}
        description={`${r.seriesText} across ${r.gamesPlayed} ${r.gamesPlayed === 1 ? "meeting" : "meetings"}. ${SERIES_DEFINITION}`}
      />

      {/* Series header */}
      <Card className="mt-6">
        <CardContent>
          {/* Each side takes an equal share and wraps its name inside a small
              inset, so a long name breaks onto a second line instead of
              running into the card edge. */}
          <div className="flex items-center justify-between gap-3">
            <Link
              href={managerPath(r.managerAName)}
              className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 px-1 hover:text-primary"
            >
              <TeamAvatar name={r.managerAName} imageUrl={r.managerAPhoto} className="h-16 w-16 shrink-0" />
              <span className="w-full text-center font-heading text-sm font-semibold break-words sm:text-base">
                {r.managerAName}
              </span>
            </Link>
            <div className="shrink-0 text-center">
              <div className="font-heading text-4xl font-semibold tabular-nums">
                {r.managerAWins}
                <span className="mx-1 text-muted-foreground">–</span>
                {r.managerBWins}
                {r.ties ? <span className="text-muted-foreground">–{r.ties}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground" title={SERIES_DEFINITION}>
                {r.seriesText}
              </div>
            </div>
            <Link
              href={managerPath(r.managerBName)}
              className="flex min-w-0 flex-1 basis-0 flex-col items-center gap-2 px-1 hover:text-primary"
            >
              <TeamAvatar name={r.managerBName} imageUrl={r.managerBPhoto} className="h-16 w-16 shrink-0" />
              <span className="w-full text-center font-heading text-sm font-semibold break-words sm:text-base">
                {r.managerBName}
              </span>
            </Link>
          </div>

          <AiText text={story} className="mx-auto mt-4 max-w-2xl text-center" />
        </CardContent>
      </Card>

      {/* Statistical comparison */}
      <Card className="mt-6">
        <CardContent>
          <h2 className="mb-2 font-heading text-lg font-semibold">Statistical comparison</h2>
          <Compare label="Wins" a={r.managerAWins} b={r.managerBWins} />
          <Compare label="Win %" a={aWinPct} b={bWinPct} format={(v) => `${(v * 100).toFixed(0)}%`} />
          <Compare label="Total points" a={r.managerAPoints} b={r.managerBPoints} format={(v) => v.toFixed(1)} />
          <Compare label="Avg score" a={r.managerAAvg} b={r.managerBAvg} format={(v) => v.toFixed(1)} />
          <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <p>
              Average margin:{" "}
              <span className="font-mono text-foreground">
                {r.averageMargin != null ? marginPts(r.averageMargin) : "—"}
              </span>
            </p>
            <p>
              Closest game:{" "}
              <span className="font-mono text-foreground">
                {r.closestGameMargin != null ? `${marginPts(r.closestGameMargin)} (${r.closestGameSeason})` : "—"}
              </span>
            </p>
            <p>
              Biggest win:{" "}
              <span className="font-mono text-foreground">
                {r.largestBlowoutMargin != null
                  ? `${nameFor(r.largestBlowoutManagerId) ?? "—"} by ${marginPts(r.largestBlowoutMargin)} (${r.largestBlowoutSeason})`
                  : "—"}
              </span>
            </p>
            <p>
              Longest streak:{" "}
              <span className="font-mono text-foreground">
                {nameFor(r.longestStreakManagerId)
                  ? `${nameFor(r.longestStreakManagerId)} ×${r.longestStreakCount}`
                  : "—"}
              </span>
            </p>
            <p>
              Current streak:{" "}
              <span className="font-mono text-foreground">
                {nameFor(r.currentStreakManagerId)
                  ? `${nameFor(r.currentStreakManagerId)} ×${r.currentStreakCount}`
                  : "—"}
              </span>
            </p>
            <p>
              Most recent:{" "}
              <span className="font-mono text-foreground">
                {r.lastMeetingSeason
                  ? `${nameFor(r.lastMeetingWinnerId) ?? "Tie"} — ${r.lastMeetingSeason} wk ${r.lastMeetingWeek}`
                  : "—"}
              </span>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Notable playoff games */}
      {playoffMeetings.length > 0 ? (
        <Card className="mt-6">
          <CardContent>
            <h2 className="mb-3 font-heading text-lg font-semibold">Playoff meetings</h2>
            <ul className="space-y-2">
              {playoffMeetings.map((m) => (
                <li key={`${m.seasonYear}-${m.week}`} className="flex flex-wrap items-center gap-2 text-sm">
                  {m.isChampionship ? (
                    <Badge className="bg-gold text-gold-foreground">
                      <Trophy className="h-3 w-3" /> Title game
                    </Badge>
                  ) : (
                    <Badge variant="outline">Playoff</Badge>
                  )}
                  <span className="font-mono tabular-nums">
                    {m.seasonYear} wk {m.week}: {m.managerAScore.toFixed(1)} – {m.managerBScore.toFixed(1)}
                  </span>
                  <span className="text-muted-foreground">
                    {m.winnerId ? `${nameFor(m.winnerId)} won` : "Tie"}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Season-by-season */}
      <Card className="mt-6">
        <CardContent>
          {chrono.length > 1 ? (
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <ChartFrame
                title="Margin, meeting by meeting"
                caption={`Up (blue) = ${r.managerAName} won, down (grey) = ${r.managerBName} won. Outlined = championship-bracket game.`}
                summary={`The winning margin of each of the ${chrono.length} meetings, oldest first.`}
                table={{ headers: ["Meeting", `Margin (${r.managerAName})`], rows: marginBars.map((m) => [m.label, m.value]) }}
                height="h-64"
              >
                <SimpleBars data={marginBars} valueLabel="Margin" diverging valueFormat="fixed0" categoryTicks={seasonTicks} />
              </ChartFrame>
              <ChartFrame
                title="The series over time"
                caption="Running wins for each side."
                summary={`Cumulative wins for ${r.managerAName} and ${r.managerBName} after each meeting.`}
                table={{ headers: ["Meeting", r.managerAName, r.managerBName], rows: running.map((x) => [x.meeting, x.a, x.b]) }}
                height="h-64"
              >
                <MultiLineChart
                  data={running}
                  xKey="meeting"
                  xLabel="Season"
                  yLabel="Wins"
                  xTickLabels={seasonTicks}
                  series={[
                    { key: "a", label: r.managerAName, color: colorA },
                    { key: "b", label: r.managerBName, color: colorB },
                  ]}
                />
              </ChartFrame>
            </div>
          ) : null}
          <h2 className="mb-3 font-heading text-lg font-semibold">Every meeting</h2>

          {/* Phone: one compact row per game. The five-column table showed
              only Season, Wk and one manager's score at 390px, with the other
              score and the result off-screen and nothing to say so. */}
          <div className="sm:hidden">
            <p className="mb-1 text-xs break-words text-muted-foreground">
              Scores read {r.managerAName} – {r.managerBName}; the winner&rsquo;s is highlighted.
            </p>
            <ul className="divide-y divide-border/50">
              {r.meetings.map((m) => (
                <li key={`${m.seasonYear}-${m.week}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm tabular-nums">
                      {m.seasonYear} · Wk {m.week}
                      <MeetingBadge m={m} />
                    </p>
                    <p className="text-xs break-words text-muted-foreground">
                      {m.winnerId ? `${nameFor(m.winnerId)} won` : "Tie"}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono text-sm tabular-nums">
                    <span className={m.winnerId === r.managerAId ? "font-semibold text-primary" : ""}>
                      {m.managerAScore.toFixed(1)}
                    </span>
                    <span className="mx-0.5 text-muted-foreground">–</span>
                    <span className={m.winnerId === r.managerBId ? "font-semibold text-primary" : ""}>
                      {m.managerBScore.toFixed(1)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Season</TableHead>
                  <TableHead>Wk</TableHead>
                  <TableHead className="text-right">{r.managerAName}</TableHead>
                  <TableHead className="text-right">{r.managerBName}</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.meetings.map((m) => (
                  <TableRow key={`${m.seasonYear}-${m.week}`}>
                    <TableCell className="font-mono tabular-nums">{m.seasonYear}</TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {m.week}
                      <MeetingBadge m={m} className="ml-2" />
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${m.winnerId === r.managerAId ? "font-semibold text-primary" : ""}`}
                    >
                      {m.managerAScore.toFixed(1)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${m.winnerId === r.managerBId ? "font-semibold text-primary" : ""}`}
                    >
                      {m.managerBScore.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.winnerId ? `${nameFor(m.winnerId)}` : "Tie"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
