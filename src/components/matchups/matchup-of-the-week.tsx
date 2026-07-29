import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { ordinal } from "@/lib/format";
import type { FeaturedMatchupView, FeaturedTeam } from "@/server/repositories/featured-matchup-repository";
import { Flame, Star, Swords } from "lucide-react";

/**
 * The Matchup of the Week — the first thing on the Matchups page.
 *
 * Everything here is a verified figure or a saved piece of copy. The game was
 * chosen by a pure function (server/stats/featured-matchup.ts); the prose was
 * written from those same figures and read from the cache. Nothing on this card
 * is produced at render time, and no number on it comes from a model.
 *
 * Before kickoff it is a preview; once both scores are in it is a recap. Which
 * one is decided by the game's own state, not the calendar.
 */

function FormPips({ form }: { form: ("W" | "L" | "T")[] }) {
  if (form.length === 0) return null;
  return (
    <span className="flex items-center gap-1" aria-label={`Recent form: ${form.join(", ")}`}>
      {form.map((result, index) => (
        <span
          key={index}
          className={`flex h-4 w-4 items-center justify-center rounded-sm text-[10px] font-bold ${
            result === "W"
              ? "bg-field/20 text-field"
              : result === "L"
                ? "bg-destructive/20 text-destructive"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

function TeamSide({
  team,
  teamsRanked,
  isFinal,
  align,
}: {
  team: FeaturedTeam;
  teamsRanked: number;
  isFinal: boolean;
  align: "left" | "right";
}) {
  const right = align === "right";
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-2 ${right ? "sm:items-end sm:text-right" : ""}`}>
      <div className={`flex min-w-0 items-center gap-3 ${right ? "sm:flex-row-reverse" : ""}`}>
        <TeamAvatar name={team.managerName} imageUrl={team.photoUrl} className="h-14 w-14 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-heading text-lg font-semibold">{team.teamName}</p>
          {team.managerId ? (
            <Link
              href={`/managers/${team.managerId}`}
              className="truncate text-sm text-muted-foreground hover:text-primary"
            >
              {team.managerName}
            </Link>
          ) : (
            <p className="truncate text-sm text-muted-foreground">{team.managerName}</p>
          )}
        </div>
      </div>

      <div className={`flex flex-wrap items-center gap-2 ${right ? "sm:justify-end" : ""}`}>
        {/* A 0-0 record before week 1 is not information, so the repository
            returns null for it rather than a zeroed one. */}
        {team.record ? (
          <Badge variant="secondary" title="Regular-season record">
            {team.record}
          </Badge>
        ) : null}
        {team.powerRank != null ? (
          <Badge variant="outline" title="Power-ranking position">
            {ordinal(team.powerRank)}
            {teamsRanked > 0 ? ` of ${teamsRanked}` : ""} in the rankings
          </Badge>
        ) : null}
        {team.standing != null ? (
          <Badge variant="outline" title="Standings position">
            {ordinal(team.standing)} in the table
          </Badge>
        ) : null}
        <FormPips form={team.recentForm} />
      </div>

      {/* Score, or the projection when there is not one yet. */}
      <div className={right ? "sm:text-right" : ""}>
        {isFinal && team.score != null ? (
          <p
            className={`font-heading text-4xl font-semibold tabular-nums ${team.isWinner ? "text-primary" : "text-muted-foreground"}`}
          >
            {team.score.toFixed(1)}
          </p>
        ) : team.projectedScore != null ? (
          <p className="font-heading text-3xl font-semibold tabular-nums text-muted-foreground">
            {team.projectedScore.toFixed(1)}
            <span className="ml-1 align-middle text-xs font-normal tracking-wide uppercase">
              projected
            </span>
          </p>
        ) : null}
      </div>

      {team.keyPlayers.length > 0 ? (
        <div className={right ? "sm:text-right" : ""}>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {isFinal ? "Top scorers" : "Players to watch"}
          </p>
          <ul className="mt-1 space-y-0.5">
            {team.keyPlayers.map((player) => (
              <li key={`${player.name}-${player.position}`} className="text-sm">
                <span className="font-medium">{player.name}</span>{" "}
                <span className="text-xs text-muted-foreground">
                  {player.position} · {player.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function MatchupOfTheWeek({ featured }: { featured: FeaturedMatchupView }) {
  const [a, b] = featured.teams;
  const { series } = featured;

  return (
    <Card className="border-primary/50 bg-card/60">
      <CardContent>
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="gap-1 bg-primary text-primary-foreground">
            <Star className="h-3 w-3" aria-hidden />
            Matchup of the Week
          </Badge>
          <span className="text-xs tracking-wide text-muted-foreground uppercase">
            {featured.seasonYear} · Week {featured.week}
            {featured.roundName ? ` · ${featured.roundName}` : ""}
          </span>
          {featured.rivalry?.isOfficial ? (
            <Link href={`/rivalries/${featured.rivalry.id}`}>
              <Badge variant="outline" className="gap-1 border-gold/50 text-gold">
                <Flame className="h-3 w-3" aria-hidden />
                {featured.rivalry.label}
              </Badge>
            </Link>
          ) : featured.rivalry ? (
            <Link href={`/rivalries/${featured.rivalry.id}`}>
              <Badge variant="outline">{featured.rivalry.label}</Badge>
            </Link>
          ) : null}
          <Badge variant="secondary">{featured.isFinal ? "Final" : "Preview"}</Badge>
        </div>

        {/* ── The two sides ──────────────────────────────────────────────── */}
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <TeamSide team={a} teamsRanked={featured.teamsRanked} isFinal={featured.isFinal} align="left" />
          <div className="flex shrink-0 items-center justify-center sm:self-center">
            <Swords className="h-5 w-5 text-muted-foreground" aria-hidden />
            <span className="sr-only">versus</span>
          </div>
          <TeamSide team={b} teamsRanked={featured.teamsRanked} isFinal={featured.isFinal} align="right" />
        </div>

        {/* ── Head-to-head series ────────────────────────────────────────── */}
        <div className="mt-5 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
          {series.games === 0 ? (
            <p className="text-sm text-muted-foreground">
              These two have never met in a game that counts.
            </p>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
              <span>
                <span className="text-xs tracking-wide text-muted-foreground uppercase">
                  Series
                </span>{" "}
                <span className="font-mono font-semibold tabular-nums">
                  {series.teamAWins}-{series.teamBWins}
                  {series.ties ? `-${series.ties}` : ""}
                </span>{" "}
                <span className="text-muted-foreground">
                  to {series.teamAWins === series.teamBWins ? "nobody" : series.teamAWins > series.teamBWins ? a.managerName : b.managerName}
                  {" over "}
                  {series.games} meeting{series.games === 1 ? "" : "s"}
                </span>
              </span>
              {series.averageMargin != null ? (
                <span className="text-muted-foreground">
                  {series.averageMargin.toFixed(1)}-point average margin
                </span>
              ) : null}
              {series.lastMeeting ? (
                <span className="text-muted-foreground">
                  Last met Week {series.lastMeeting.week}, {series.lastMeeting.seasonYear}
                  {series.lastMeeting.winnerName ? ` — ${series.lastMeeting.winnerName} won` : " — tied"}
                </span>
              ) : null}
            </div>
          )}
        </div>

        {/* ── The written preview or recap ───────────────────────────────── */}
        {featured.commentary ? (
          <div className="mt-4">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {featured.commentary.kind === "RECAP" ? "The recap" : "The preview"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">
              {featured.commentary.text}
            </p>
          </div>
        ) : null}

        {/* ── Why this game, in checkable terms ──────────────────────────── */}
        {featured.why.length > 0 ? (
          <details className="mt-4 rounded-md border border-border/60 bg-card/30 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Why this game
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              Chosen by formula, not by opinion — projected closeness, standings stakes, official
              rivalry status, combined power ranking, recent form and how tight the series has been.
              Nothing about this choice is written by a model.
            </p>
            <ul className="mt-2 space-y-1">
              {featured.why.map((factor) => (
                <li key={factor.key} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="font-medium text-foreground">{factor.label}</span>
                  <span className="font-mono tabular-nums text-primary">
                    {Math.round(factor.weight * 100)}%
                  </span>
                  <span className="text-muted-foreground">{factor.reason}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <Link
          href={featured.href}
          className="mt-4 inline-block text-sm font-medium text-primary hover:underline"
        >
          Full matchup detail, rosters and scoring →
        </Link>
      </CardContent>
    </Card>
  );
}
