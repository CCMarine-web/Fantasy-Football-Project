import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { listRivalries } from "@/server/repositories/rivalry-repository";
import { Swords } from "lucide-react";

export const metadata = { title: "Rivalries" };

export default async function RivalriesPage() {
  const rivalries = await listRivalries();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Bad Blood"
        title="Rivalries"
        description="Automatically calculated from head-to-head history — games played, playoff meetings, and current bragging rights."
      />
      <div className="mt-8 space-y-4">
        {rivalries.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="No rivalries yet"
            description="Rivalries are calculated once managers have met a few times."
          />
        ) : (
          rivalries.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <TeamAvatar name={r.managerA.displayName} imageUrl={r.managerA.avatarUrl} className="h-10 w-10" />
                  <div className="text-center">
                    <p className="font-mono text-lg font-semibold tabular-nums">
                      {r.managerAWins}-{r.managerBWins}
                      {r.ties ? `-${r.ties}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{r.gamesPlayed} games</p>
                  </div>
                  <TeamAvatar name={r.managerB.displayName} imageUrl={r.managerB.avatarUrl} className="h-10 w-10" />
                </div>
                <div className="flex-1">
                  <p className="font-heading text-sm font-semibold uppercase">
                    {r.managerA.displayName} vs. {r.managerB.displayName}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {r.playoffMeetings > 0 ? <Badge variant="outline">{r.playoffMeetings} playoff meetings</Badge> : null}
                    {r.closestGameMargin != null ? (
                      <Badge variant="outline">Closest: {r.closestGameMargin.toFixed(1)} pts</Badge>
                    ) : null}
                    {r.largestBlowoutMargin != null ? (
                      <Badge variant="outline">Biggest blowout: {r.largestBlowoutMargin.toFixed(1)} pts</Badge>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
