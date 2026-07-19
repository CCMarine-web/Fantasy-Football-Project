import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { getPowerRankings } from "@/server/repositories/power-rankings-repository";
import { isAIConfigured } from "@/lib/env";
import type { PowerRankingFactors } from "@/server/stats";
import { ChevronDown, ChevronUp, Minus, TrendingUp } from "lucide-react";

export const metadata = { title: "Power Rankings" };

const FACTOR_ORDER: { key: keyof PowerRankingFactors; label: string; weight: string }[] = [
  { key: "allPlayWinPct", label: "All-Play", weight: "30%" },
  { key: "recentForm", label: "Recent Form", weight: "25%" },
  { key: "seasonPoints", label: "Scoring", weight: "20%" },
  { key: "strengthOfWins", label: "Quality Wins", weight: "15%" },
  { key: "consistency", label: "Consistency", weight: "10%" },
];

function Movement({ movement }: { movement: number | null }) {
  if (movement == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> new
      </span>
    );
  }
  if (movement > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-field">
        <ChevronUp className="h-3.5 w-3.5" />
        {movement}
      </span>
    );
  }
  if (movement < 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-destructive">
        <ChevronDown className="h-3.5 w-3.5" />
        {Math.abs(movement)}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
      <Minus className="h-3 w-3" />
    </span>
  );
}

function FactorBar({ label, weight, value }: { label: string; weight: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">
        {label} <span className="text-muted-foreground/60">{weight}</span>
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, value)}%` }} />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {value.toFixed(0)}
      </span>
    </div>
  );
}

export default async function PowerRankingsPage() {
  const data = await getPowerRankings();

  if (!data || data.rows.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="The Rat Trap" title="Power Rankings" />
        <div className="mt-8">
          <EmptyState
            icon={TrendingUp}
            title="No games to rank yet"
            description="Power rankings appear once the season has been played. In the offseason they show last season's final rankings."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow={data.isFinal ? `${data.seasonYear} Final` : `${data.seasonYear} · Week ${data.asOfWeek}`}
        title="Power Rankings"
        description={
          data.isFinal
            ? `Final power rankings for the ${data.seasonYear} season. A composite of all-play record (30%), recent form (25%), scoring (20%), quality of wins (15%), and consistency (10%) — normalized across the league.`
            : `A composite of all-play record (30%), recent form (25%), scoring (20%), quality of wins (15%), and consistency (10%). Arrows show movement since Week ${data.asOfWeek - 1}.`
        }
      />

      {!isAIConfigured() ? (
        <p className="mt-4 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          Team blurbs below are placeholder text. Add an <code>OPENAI_API_KEY</code> to generate real
          commentary with attitude.
        </p>
      ) : null}

      <div className="mt-6 space-y-3">
        {data.rows.map((row) => (
          <Card key={row.managerId}>
            <CardContent className="flex flex-col gap-4 sm:flex-row">
              {/* Rank + movement */}
              <div className="flex shrink-0 flex-row items-center gap-3 sm:w-16 sm:flex-col sm:items-center sm:gap-1">
                <span className="font-heading text-3xl font-semibold tabular-nums">{row.rank}</span>
                <Movement movement={row.movement} />
              </div>

              {/* Team + blurb */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-9 w-9" />
                  <div className="min-w-0">
                    <Link
                      href={`/managers/${row.managerId}`}
                      className="block truncate font-heading text-lg font-semibold hover:text-primary"
                    >
                      {row.teamName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.managerName} · {row.record} · All-play {row.raw.allPlayRecord} ·{" "}
                      {row.raw.seasonPointsFor.toFixed(0)} PF
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-foreground/90">{row.blurb}</p>
              </div>

              {/* Score + factor breakdown */}
              <div className="shrink-0 sm:w-72">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs tracking-wide text-muted-foreground uppercase">
                    Power Score
                  </span>
                  <span className="font-heading text-2xl font-semibold tabular-nums text-primary">
                    {row.score.toFixed(1)}
                  </span>
                </div>
                <div className="space-y-1">
                  {FACTOR_ORDER.map((f) => (
                    <FactorBar key={f.key} label={f.label} weight={f.weight} value={row.factors[f.key]} />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Badge variant="outline">All-play record removes schedule luck</Badge>
        <Badge variant="outline">Recent form weights the last 4 weeks</Badge>
        <Badge variant="outline">Consistency rewards low scoring variance</Badge>
      </div>
    </div>
  );
}
