import Link from "next/link";
import { Crown, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { DaysAsChampion } from "@/components/championship/days-as-champion";
import type { CurrentChampion } from "@/server/repositories/championship-belt-repository";

/**
 * The prominent homepage Championship Belt banner. Shows the defending champion
 * until a new title is officially recorded (getCurrentChampion reads the most
 * recent COMPLETE season). Reused on the homepage; the full lineage + editing
 * lives on /championship-belt.
 */
export function ChampionshipBeltFeature({
  champion,
  summary,
}: {
  champion: CurrentChampion;
  summary?: string | null;
}) {
  const record = `${champion.wins}-${champion.losses}${champion.ties ? `-${champion.ties}` : ""}`;
  return (
    <Card className="overflow-hidden border-gold/40 bg-gradient-to-br from-gold/10 via-card to-card">
      <CardContent className="p-0">
        <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center">
          <div className="flex items-center gap-4 lg:flex-col lg:items-center lg:text-center">
            <TeamAvatar
              name={champion.managerName}
              imageUrl={champion.photoUrl}
              className="h-24 w-24 border-2 border-gold/60 shadow-lg lg:h-32 lg:w-32"
            />
            <div className="lg:mt-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-gold uppercase">
                <Crown className="h-4 w-4" /> Reigning Champion
              </p>
              <p className="font-heading text-2xl font-semibold">{champion.managerName}</p>
              <p className="text-sm text-muted-foreground">{champion.teamName}</p>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-gold text-gold-foreground">{champion.year} Champion</Badge>
              <Badge variant="outline" className="font-mono">
                {record}
              </Badge>
              <Badge variant="outline" className="font-mono">
                {champion.pointsFor.toFixed(0)} PF
              </Badge>
              {champion.regularSeasonRank ? (
                <Badge variant="secondary">#{champion.regularSeasonRank} seed</Badge>
              ) : null}
            </div>

            {summary ? (
              <p className="text-sm leading-relaxed text-foreground/90">{summary}</p>
            ) : null}

            {champion.playoffRun.length > 0 ? (
              <div>
                <p className="mb-1.5 text-xs tracking-wide text-muted-foreground uppercase">Title Run</p>
                <div className="flex flex-wrap gap-2">
                  {champion.playoffRun.map((g) => (
                    <span
                      key={g.week}
                      className="rounded-md border border-border/60 bg-background/60 px-2 py-1 text-xs"
                    >
                      <span className="text-muted-foreground">{g.roundName ?? `Wk ${g.week}`}: </span>
                      <span className={g.result === "W" ? "font-semibold text-primary" : ""}>
                        {g.result ?? "—"}
                      </span>{" "}
                      <span className="font-mono text-muted-foreground">
                        {g.championScore?.toFixed(1) ?? "—"}–{g.opponentScore?.toFixed(1) ?? "—"}
                      </span>{" "}
                      <span className="text-muted-foreground">vs {g.opponentName}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {champion.victorySpeech ? (
              <blockquote className="border-l-2 border-gold/50 pl-3 text-sm italic text-foreground/90">
                “{champion.victorySpeech}”
              </blockquote>
            ) : null}

            <div className="flex items-center gap-4 pt-1">
              <DaysAsChampion isoStart={champion.championSince} />
              <Link href="/championship-belt" className="text-sm text-primary hover:underline">
                Belt history →
              </Link>
            </div>
          </div>

          <Trophy className="hidden h-16 w-16 shrink-0 text-gold/40 lg:block" aria-hidden />
        </div>
      </CardContent>
    </Card>
  );
}
