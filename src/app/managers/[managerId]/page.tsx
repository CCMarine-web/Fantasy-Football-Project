import { notFound } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { getManagerProfile } from "@/server/repositories/manager-repository";
import { Quote, Sparkles, Swords } from "lucide-react";

export const metadata = { title: "Manager Profile" };

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export default async function ManagerProfilePage({
  params,
}: {
  params: Promise<{ managerId: string }>;
}) {
  const { managerId } = await params;
  const profile = await getManagerProfile(managerId);
  if (!profile) notFound();

  const { manager, stats, rivalries } = profile;
  const currentTeam = manager.fantasyTeams[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
        <TeamAvatar name={manager.displayName} imageUrl={manager.avatarUrl} className="h-20 w-20" />
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
            {currentTeam?.teamName ?? "Free Agent"}
          </p>
          <h1 className="font-heading text-3xl font-semibold uppercase sm:text-4xl">
            {manager.displayName}
          </h1>
          {manager.bio ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{manager.bio}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {stats.championships > 0 ? (
              <Badge className="bg-gold text-gold-foreground">{stats.championships}&times; Champion</Badge>
            ) : null}
            {stats.finalsAppearances > 0 ? (
              <Badge variant="secondary">{stats.finalsAppearances} Finals Appearances</Badge>
            ) : null}
            {manager.noRoast ? <Badge variant="outline">No-Roast Opt-Out</Badge> : null}
            {!manager.isActive ? <Badge variant="outline">Inactive</Badge> : null}
          </div>
        </div>
      </div>

      <Separator className="my-8" />

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Career Record</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Record"
            value={`${stats.record.wins}-${stats.record.losses}${stats.record.ties ? `-${stats.record.ties}` : ""}`}
          />
          <StatTile label="Win %" value={stats.winningPercentage.toFixed(3)} />
          <StatTile label="Playoff Appearances" value={stats.playoffAppearances} />
          <StatTile label="Avg. Finish" value={stats.averageFinish || "—"} />
          <StatTile label="Total Points For" value={stats.totalPointsFor.toFixed(1)} />
          <StatTile label="Total Points Against" value={stats.totalPointsAgainst.toFixed(1)} />
          <StatTile label="Longest Win Streak" value={stats.longestWinningStreak} />
          <StatTile label="Longest Losing Streak" value={stats.longestLosingStreak} />
        </div>
      </section>

      <Separator className="my-8" />

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Annual Finishes</h2>
        {stats.finishes.length === 0 ? (
          <EmptyState title="No completed seasons yet" />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Season</th>
                  <th className="px-4 py-2 text-right">Regular Season Rank</th>
                  <th className="px-4 py-2 text-right">Final Rank</th>
                  <th className="px-4 py-2 text-right">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {stats.finishes.map((f) => (
                  <tr key={f.season}>
                    <td className="px-4 py-2 font-medium">{f.season}</td>
                    <td className="px-4 py-2 text-right font-mono">{f.regularSeasonRank}</td>
                    <td className="px-4 py-2 text-right font-mono">{f.finalRank}</td>
                    <td className="px-4 py-2 text-right">
                      {f.isChampion ? (
                        <Badge className="bg-gold text-gold-foreground">Champion</Badge>
                      ) : f.isRunnerUp ? (
                        <Badge variant="secondary">Runner-Up</Badge>
                      ) : f.madePlayoffs ? (
                        <Badge variant="outline">Playoffs</Badge>
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

      <Separator className="my-8" />

      <section>
        <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Team Name History</h2>
        <div className="mt-4 flex flex-wrap gap-2">
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

      <Separator className="my-8" />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Swords className="h-4 w-4" /> Rivalries
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rivalries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No established rivalries yet.</p>
            ) : (
              <ul className="space-y-2">
                {rivalries.map(({ rivalry, opponent }) => (
                  <li key={rivalry.id} className="flex items-center justify-between text-sm">
                    <span className="font-medium">{opponent.displayName}</span>
                    <span className="font-mono text-muted-foreground">
                      {rivalry.managerAId === manager.id
                        ? `${rivalry.managerAWins}-${rivalry.managerBWins}`
                        : `${rivalry.managerBWins}-${rivalry.managerAWins}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 uppercase">
              <Sparkles className="h-4 w-4" /> AI Manager Profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              A generated narrative profile — draft tendencies, trade behavior, and career arc — will
              appear here once AI content generation is enabled for this league.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
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
