import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getRivalryDetail } from "@/server/repositories/computed-rivalries-repository";
import { Trophy } from "lucide-react";

export async function generateMetadata({ params }: { params: Promise<{ rivalryId: string }> }) {
  const { rivalryId } = await params;
  const r = await getRivalryDetail(rivalryId);
  return { title: r ? `${r.managerAName} vs ${r.managerBName}` : "Rivalry" };
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
  const { rivalryId } = await params;
  const r = await getRivalryDetail(rivalryId);
  if (!r) notFound();

  const nameFor = (id: string | null) =>
    id === r.managerAId ? r.managerAName : id === r.managerBId ? r.managerBName : null;

  /*
   * Championship bracket only. A consolation meeting is a real game and stays
   * in the season-by-season log below, but it is not postseason history: the
   * teams in it were already eliminated, so listing it here under "Postseason
   * meetings" gave a placement game the weight of a semifinal.
   */
  const playoffMeetings = r.meetings.filter((m) => m.isPlayoff && m.bracketType === "WINNERS");
  const aWinPct = r.gamesPlayed ? r.managerAWins / r.gamesPlayed : null;
  const bWinPct = r.gamesPlayed ? r.managerBWins / r.gamesPlayed : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={r.isOfficial ? "Official rivalry" : "Head to head"}
        title={`${r.managerAName} vs ${r.managerBName}`}
        description={`${r.gamesPlayed} meetings on record, computed from verified results.`}
      />

      {/* Series header */}
      <Card className="mt-6">
        <CardContent>
          <div className="flex items-center justify-between gap-3">
            <Link href={`/managers/${r.managerAId}`} className="flex min-w-0 flex-col items-center gap-2 hover:text-primary">
              <TeamAvatar name={r.managerAName} imageUrl={r.managerAPhoto} className="h-16 w-16" />
              <span className="truncate font-heading text-base font-semibold">{r.managerAName}</span>
            </Link>
            <div className="shrink-0 text-center">
              <div className="font-heading text-4xl font-semibold tabular-nums">
                {r.managerAWins}
                <span className="mx-1 text-muted-foreground">–</span>
                {r.managerBWins}
                {r.ties ? <span className="text-muted-foreground">–{r.ties}</span> : null}
              </div>
              <div className="text-xs text-muted-foreground">series record</div>
            </div>
            <Link href={`/managers/${r.managerBId}`} className="flex min-w-0 flex-col items-center gap-2 hover:text-primary">
              <TeamAvatar name={r.managerBName} imageUrl={r.managerBPhoto} className="h-16 w-16" />
              <span className="truncate font-heading text-base font-semibold">{r.managerBName}</span>
            </Link>
          </div>

          {r.blurb ? <p className="mt-4 text-center text-sm text-foreground/90">{r.blurb}</p> : null}
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
            <p>Average margin: <span className="font-mono text-foreground">{r.averageMargin ?? "—"}</span></p>
            <p>
              Closest game:{" "}
              <span className="font-mono text-foreground">
                {r.closestGameMargin != null ? `${r.closestGameMargin} pts (${r.closestGameSeason})` : "—"}
              </span>
            </p>
            <p>
              Biggest win:{" "}
              <span className="font-mono text-foreground">
                {r.largestBlowoutMargin != null
                  ? `${nameFor(r.largestBlowoutManagerId) ?? "—"} by ${r.largestBlowoutMargin} (${r.largestBlowoutSeason})`
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
          <h2 className="mb-3 font-heading text-lg font-semibold">Every meeting</h2>
          <div className="overflow-x-auto">
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
                      {/* Only the championship bracket earns a postseason
                          badge. A "PO" beside a placement game claimed a
                          playoff meeting that never happened. */}
                      {m.isChampionship ? (
                        <Badge className="ml-2 bg-gold text-gold-foreground">Title</Badge>
                      ) : m.isPlayoff && m.bracketType === "WINNERS" ? (
                        <Badge variant="outline" className="ml-2">
                          PO
                        </Badge>
                      ) : null}
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
