import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { getComputedRivalries, type RivalryView } from "@/server/repositories/computed-rivalries-repository";
import { Swords, Trophy } from "lucide-react";

export const metadata = { title: "Rivalries" };

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function RivalryCard({ r }: { r: RivalryView }) {
  const aLeads = r.managerAWins > r.managerBWins;
  const bLeads = r.managerBWins > r.managerAWins;
  const nameFor = (id: string | null) =>
    id === r.managerAId ? r.managerAName : id === r.managerBId ? r.managerBName : null;
  const streakName = nameFor(r.currentStreakManagerId);
  const longestName = nameFor(r.longestStreakManagerId);

  return (
    <Card className={r.isOfficial ? "border-primary/40" : undefined}>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {r.isOfficial ? <Badge>Official rivalry</Badge> : null}
          {r.championshipMeetings > 0 ? (
            <Badge className="bg-gold text-gold-foreground">
              <Trophy className="h-3 w-3" /> {r.championshipMeetings} title game
              {r.championshipMeetings > 1 ? "s" : ""}
            </Badge>
          ) : null}
          {r.playoffMeetings > 0 ? <Badge variant="outline">{r.playoffMeetings} playoff</Badge> : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <Link href={`/managers/${r.managerAId}`} className="flex min-w-0 items-center gap-2 hover:text-primary">
            <TeamAvatar name={r.managerAName} imageUrl={r.managerAPhoto} className="h-10 w-10" />
            <span className={`truncate font-heading text-base font-semibold ${aLeads ? "text-primary" : ""}`}>
              {r.managerAName}
            </span>
          </Link>

          <div className="shrink-0 text-center">
            <div className="font-heading text-2xl font-semibold tabular-nums">
              {r.managerAWins}
              <span className="mx-1 text-muted-foreground">–</span>
              {r.managerBWins}
              {r.ties ? <span className="text-muted-foreground">–{r.ties}</span> : null}
            </div>
            <div className="text-xs text-muted-foreground">{r.gamesPlayed} meetings</div>
          </div>

          <Link
            href={`/managers/${r.managerBId}`}
            className="flex min-w-0 items-center justify-end gap-2 hover:text-primary"
          >
            <span className={`truncate text-right font-heading text-base font-semibold ${bLeads ? "text-primary" : ""}`}>
              {r.managerBName}
            </span>
            <TeamAvatar name={r.managerBName} imageUrl={r.managerBPhoto} className="h-10 w-10" />
          </Link>
        </div>

        {r.blurb ? <p className="text-sm text-foreground/90">{r.blurb}</p> : null}

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Total points" value={`${Math.round(r.managerAPoints)} – ${Math.round(r.managerBPoints)}`} />
          <Stat label="Avg score" value={`${r.managerAAvg ?? "—"} – ${r.managerBAvg ?? "—"}`} />
          <Stat label="Avg margin" value={r.averageMargin != null ? `${r.averageMargin}` : "—"} />
          <Stat
            label="Closest"
            value={r.closestGameMargin != null ? `${r.closestGameMargin} (${r.closestGameSeason})` : "—"}
          />
          <Stat
            label="Biggest win"
            value={r.largestBlowoutMargin != null ? `${r.largestBlowoutMargin} (${r.largestBlowoutSeason})` : "—"}
          />
          <Stat label="Current streak" value={streakName ? `${streakName} ×${r.currentStreakCount}` : "—"} />
          <Stat label="Longest streak" value={longestName ? `${longestName} ×${r.longestStreakCount}` : "—"} />
          <Stat
            label="Last meeting"
            value={r.lastMeetingSeason ? `${r.lastMeetingSeason} wk ${r.lastMeetingWeek}` : "—"}
          />
        </dl>

        <Link href={`/rivalries/${r.id}`} className="inline-block text-sm font-medium text-primary hover:underline">
          Season-by-season history →
        </Link>
      </CardContent>
    </Card>
  );
}

export default async function RivalriesPage() {
  const all = await getComputedRivalries();
  const official = all.filter((r) => r.isOfficial);
  const others = all.filter((r) => !r.isOfficial).slice(0, 8);

  if (all.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <PageHeader eyebrow="Bad Blood" title="Rivalries" />
        <div className="mt-8">
          <EmptyState
            icon={Swords}
            title="No rivalries yet"
            description="Rivalry records appear once managers have played each other and the rivalry import has run."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Bad Blood"
        title="Rivalries"
        description="The league's declared rivalries, plus the closest-fought pairings by the numbers. Every record is computed from verified matchup results."
      />

      {official.length > 0 ? (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-primary" aria-hidden />
            <h2 className="font-heading text-2xl font-semibold tracking-wide uppercase">
              Official rivalries
            </h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Declared by the commissioner — the grudges the league recognises by name.
          </p>
          <div className="mt-4 space-y-4">
            {official.map((r) => (
              <RivalryCard key={r.id} r={r} />
            ))}
          </div>
        </section>
      ) : null}

      {/*
        The two sections used to run together, so the unofficial pairings read
        as more commissioner-declared rivalries. The break is now unmistakable:
        a full-bleed rule, a labelled divider, a much larger heading and its own
        tinted panel — all of which hold up at mobile width as well as desktop.
      */}
      {others.length > 0 ? (
        <>
          {official.length > 0 ? (
            <div className="relative mt-16 mb-10" aria-hidden>
              <div className="absolute inset-0 flex items-center">
                <div className="h-px w-full bg-gradient-to-r from-transparent via-border to-transparent" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-4 text-[11px] font-semibold tracking-[0.25em] text-muted-foreground uppercase">
                  Not official — but still personal
                </span>
              </div>
            </div>
          ) : null}

          <section className="rounded-2xl border border-border/60 bg-card/30 p-4 sm:p-6">
            <h2 className="font-heading text-2xl font-semibold tracking-wide uppercase sm:text-3xl">
              Other heated pairings
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              These are <strong className="text-foreground">not</strong> official rivalries. Nobody
              declared them — they surfaced from the results: pairings that have met often, met with
              something on the line, or kept finishing within a handful of points. Ranked by meetings,
              postseason stakes and how close the games have been.
            </p>
            <div className="mt-5 space-y-4">
              {others.map((r) => (
                <RivalryCard key={r.id} r={r} />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
