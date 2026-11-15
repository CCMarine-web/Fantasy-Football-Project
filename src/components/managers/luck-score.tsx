import { Badge } from "@/components/ui/badge";
import { CLOSE_MARGIN, formatLuckWins, luckRankText, MIN_LUCK_GAMES } from "@/server/stats/luck-wins";
import type { RankedLuck } from "@/server/repositories/luck-repository";

/**
 * Luck, in wins — the site's one luck number (server/stats/luck-wins.ts):
 * actual wins minus the wins a team's scores would have earned against the
 * whole league each week. Labels come from a sample-size-aware z-score, so a
 * season and a career read on the same scale. The other measures are context
 * rows with their sample sizes, never blended into the number.
 */

function tone(l: RankedLuck): string {
  if (l.tone === "lucky") return "border-field/40 bg-field/10 text-field";
  if (l.tone === "unlucky") return "border-destructive/40 bg-destructive/10 text-destructive";
  return "border-border/60 bg-muted text-muted-foreground";
}

export function luckSummary(l: RankedLuck): string {
  if (l.tone === "insufficient") return `Not enough games (${l.games} of ${MIN_LUCK_GAMES})`;
  return `${formatLuckWins(l.luckWins)} · ${l.label}`;
}

/** Compact badge for lists and tables. */
export function LuckBadge({ luck, prefix }: { luck: RankedLuck; prefix?: string }) {
  return (
    <Badge
      className={`border ${tone(luck)}`}
      title={`${luck.wins} wins vs ${luck.expected.toFixed(1)} expected from scoring, over ${luck.games} regular-season games. ${luckRankText(luck).replace(/^./, (c) => c.toUpperCase())} in the league.`}
    >
      {prefix ? `${prefix} ` : ""}Luck {luckSummary(luck)}
    </Badge>
  );
}

function Headline({ title, luck }: { title: string; luck: RankedLuck }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{title}</p>
      {luck.tone === "insufficient" ? (
        <p className="font-heading text-lg font-semibold text-muted-foreground">Not enough games</p>
      ) : (
        <>
          <p className="font-mono text-2xl leading-tight font-semibold tabular-nums">
            <span className={luck.tone === "lucky" ? "text-field" : luck.tone === "unlucky" ? "text-destructive" : ""}>
              {formatLuckWins(luck.luckWins)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {luck.label} · {luckRankText(luck)} ·{" "}
            {luck.wins} W vs {luck.expected.toFixed(1)} expected · {luck.games} games
          </p>
        </>
      )}
    </div>
  );
}

/** Beside the manager's name: this season and career, same definition. */
export function LuckHeadline({
  career,
  season,
  seasonYear,
}: {
  career: RankedLuck | null;
  season: RankedLuck | null;
  seasonYear: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      {season ? <Headline title={`${seasonYear ?? "Season"} luck`} luck={season} /> : null}
      {career ? <Headline title="Career luck" luck={career} /> : null}
      <p className="col-span-2 text-[11px] text-muted-foreground">
        Wins above (or below) what the team&rsquo;s scores would have earned against the whole league each week.
      </p>
    </div>
  );
}

/** The context rows: plain stats with their sample sizes, not blended into the number. */
export function LuckContextPanel({ career, season, seasonYear }: { career: RankedLuck | null; season: RankedLuck | null; seasonYear: number | null }) {
  const rows = (l: RankedLuck) => [
    {
      k: "Opponent scoring",
      v: l.context.opponentScoring
        ? `opponents scored ${l.context.opponentScoring.perGame > 0 ? "+" : ""}${l.context.opponentScoring.perGame.toFixed(1)} per game vs the rest of the field`
        : "—",
      n: l.context.opponentScoring ? `${l.context.opponentScoring.games} games` : "",
    },
    {
      k: "Close games",
      v: `${l.context.closeGames.wins}-${l.context.closeGames.losses} in games decided by under ${CLOSE_MARGIN} points`,
      n: `${l.context.closeGames.games} games`,
    },
    {
      k: "Playoff draw",
      v: l.context.playoffDraw
        ? `championship-bracket opponents scored ${Math.abs(l.context.playoffDraw.pctAboveAverage).toFixed(1)}% ${l.context.playoffDraw.pctAboveAverage >= 0 ? "above" : "below"} their season average`
        : "no championship-bracket games",
      n: l.context.playoffDraw ? `${l.context.playoffDraw.games} playoff game${l.context.playoffDraw.games === 1 ? "" : "s"}` : "",
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[
        { title: `${seasonYear ?? "This season"}`, l: season },
        { title: "Career", l: career },
      ].map(({ title, l }) =>
        l ? (
          <div key={title} className="rounded-lg border border-border/60 bg-card/40 p-4">
            <p className="font-heading text-sm font-semibold tracking-wide uppercase">{title}</p>
            <p className="mt-1 font-mono text-lg tabular-nums">{luckSummary(l)}</p>
            <dl className="mt-2 space-y-1.5 text-sm">
              {rows(l).map((r) => (
                <div key={r.k} className="grid grid-cols-[7.5rem_1fr] gap-2">
                  <dt className="text-muted-foreground">{r.k}</dt>
                  <dd>
                    {r.v} {r.n ? <span className="text-xs text-muted-foreground">({r.n})</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null,
      )}
      <details className="md:col-span-2 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-foreground">How it&rsquo;s calculated</summary>
        <p className="mt-2">
          Each completed regular-season week, a team&rsquo;s expected wins are the share of the league it out-scored (ties count half),
          divided by the number of other teams that played. Luck is actual wins minus the sum of those. The label weighs that against
          how much luck that many games could produce (a z-score): under 0.5 Neutral, 0.5–1 Slightly, 1–2 Lucky or Unlucky, over 2
          Extremely. Under {MIN_LUCK_GAMES} games there is no label. Playoff and consolation games never count toward the number; the rows
          above are context only.
        </p>
      </details>
    </div>
  );
}
