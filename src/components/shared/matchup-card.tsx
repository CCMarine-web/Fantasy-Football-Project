import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { cn } from "@/lib/utils";
import type { MatchupCardData, MatchupCardTeam } from "@/types/view-models";

function TeamRow({ team, status }: { team: MatchupCardTeam; status: MatchupCardData["status"] }) {
  const showFinal = status === "FINAL";
  const primaryValue = showFinal ? team.score : team.projectedScore;
  const label = showFinal ? team.score?.toFixed(1) : team.projectedScore?.toFixed(1);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-md px-3 py-2",
        showFinal && team.isWinner && "bg-accent/60",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <TeamAvatar name={team.managerName} imageUrl={team.avatarUrl} className="h-9 w-9" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{team.teamName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {team.managerName}
            {team.record ? ` · ${team.record}` : ""}
          </p>
        </div>
      </div>
      <span
        className={cn(
          "font-mono text-lg font-semibold tabular-nums",
          showFinal && team.isWinner ? "text-primary" : "text-foreground",
          primaryValue == null && "text-muted-foreground",
        )}
      >
        {label ?? "—"}
      </span>
    </div>
  );
}

export function MatchupCard({ data, className }: { data: MatchupCardData; className?: string }) {
  const href = `/matchups/${data.season}/${data.week}/${data.matchupId}`;
  return (
    <Link href={href} className="block">
      <Card
        className={cn(
          "gap-2 p-3 transition-colors hover:border-primary/60",
          className,
        )}
      >
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Week {data.week}
            {data.roundName ? ` · ${data.roundName}` : ""}
          </span>
          <Badge
            variant={data.status === "FINAL" ? "secondary" : "outline"}
            className="text-[10px] tracking-wide uppercase"
          >
            {data.status === "IN_PROGRESS" ? "Live" : data.status === "FINAL" ? "Final" : "Upcoming"}
          </Badge>
        </div>
        <div className="flex flex-col divide-y divide-border/60">
          <TeamRow team={data.teams[0]} status={data.status} />
          <TeamRow team={data.teams[1]} status={data.status} />
        </div>
      </Card>
    </Link>
  );
}
