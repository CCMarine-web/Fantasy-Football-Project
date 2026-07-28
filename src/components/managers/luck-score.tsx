import { Badge } from "@/components/ui/badge";
import { LUCK_CLOSE_GAME_MARGIN, LUCK_WEIGHTS, type LuckScore } from "@/server/stats/luck";

/**
 * Presentation for the Luck Score. The number itself is computed in
 * server/stats/luck.ts from recorded scores only — nothing here decides
 * anything, it just renders what the maths produced.
 */

function toneFor(score: number): string {
  if (score >= 65) return "border-field/50 bg-field/15 text-field";
  if (score >= 56) return "border-field/30 bg-field/10 text-field";
  if (score > 44) return "border-border/60 bg-muted text-muted-foreground";
  if (score > 35) return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-destructive/50 bg-destructive/15 text-destructive";
}

const CONFIDENCE_TEXT: Record<LuckScore["confidence"], string> = {
  HIGH: "High confidence",
  MEDIUM: "Medium confidence",
  LOW: "Low confidence — few games",
  INSUFFICIENT: "Not enough data",
};

/**
 * Compact badge for lists. Never renders "Neutral" for a manager who simply
 * has not played enough — an unmeasured score says so.
 */
export function LuckScoreBadge({ luck, prefix }: { luck: LuckScore; prefix?: string }) {
  if (luck.score == null) {
    return (
      <Badge variant="outline" className="border-dashed text-muted-foreground" title={luck.caveat ?? undefined}>
        {prefix ? `${prefix} ` : ""}Luck: not enough games
      </Badge>
    );
  }
  return (
    <Badge
      className={`border ${toneFor(luck.score)}`}
      title={`${luck.label}. ${CONFIDENCE_TEXT[luck.confidence]}. Measured over ${luck.gamesConsidered} regular-season games.`}
    >
      {prefix ? `${prefix} ` : ""}Luck {luck.score} · {luck.label}
    </Badge>
  );
}

/**
 * The full panel: the number, what it means in one line, the component
 * breakdown that produced it, and the caveats. Shown on a manager's profile.
 */
export function LuckScorePanel({
  career,
  season,
  seasonYear,
}: {
  career: LuckScore;
  season: LuckScore | null;
  seasonYear: number | null;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold tracking-wide uppercase">Luck Score</h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            How much of this record the schedule handed over. 50 is neutral; above it the results
            flatter the scoring, below it they understate it. It measures the draw, not the manager.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <LuckNumber label="Career" luck={career} />
          {season ? <LuckNumber label={seasonYear ? String(seasonYear) : "Season"} luck={season} /> : null}
        </div>
      </div>

      {career.score != null ? (
        <div className="mt-4 space-y-2">
          {career.components.map((c) => (
            <div key={c.key} className="grid grid-cols-[9rem_1fr] items-start gap-3 text-sm sm:grid-cols-[11rem_1fr]">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">
                  {c.available
                    ? `${(c.weight * 100).toFixed(0)}% of the score`
                    : "not measured"}
                </p>
              </div>
              <div className="min-w-0">
                {c.available && c.deviation != null ? (
                  <div className="flex items-center gap-2">
                    {/* A centre-anchored bar: right of centre is lucky. */}
                    <div className="relative h-2 w-24 shrink-0 rounded-full bg-muted" aria-hidden>
                      <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
                      <div
                        className={`absolute inset-y-0 rounded-full ${c.deviation >= 0 ? "bg-field" : "bg-destructive"}`}
                        style={
                          c.deviation >= 0
                            ? { left: "50%", width: `${Math.min(50, c.deviation * 50)}%` }
                            : { right: "50%", width: `${Math.min(50, -c.deviation * 50)}%` }
                        }
                      />
                    </div>
                    <span className="min-w-0 text-xs text-muted-foreground">{c.detail}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{c.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {career.caveat ? (
        <p className="mt-4 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          {career.caveat}
        </p>
      ) : null}

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium text-primary">How it is calculated</summary>
        <div className="mt-2 space-y-2">
          <p>
            Five measurements, each expressed as how far this manager sits from the league norm, then
            combined at fixed weights: wins against all-play expectation{" "}
            {(LUCK_WEIGHTS.winsVsExpected * 100).toFixed(0)}%, opponent scoring{" "}
            {(LUCK_WEIGHTS.opponentScoring * 100).toFixed(0)}%, record in games decided by under{" "}
            {LUCK_CLOSE_GAME_MARGIN} points {(LUCK_WEIGHTS.closeGames * 100).toFixed(0)}%, strength of
            the opponents drawn {(LUCK_WEIGHTS.scheduleStrength * 100).toFixed(0)}%, and the
            championship-bracket draw {(LUCK_WEIGHTS.postseasonDraw * 100).toFixed(0)}%.
          </p>
          <p>
            Only the regular season counts toward the first four, because that is the schedule nobody
            chose. A component that cannot be measured — no close games, no postseason — is dropped
            and the remaining weights are rescaled to sum to 100%, rather than being scored as
            neutral. The result is rounded to a whole number on a 0-100 scale.
          </p>
          <p>
            The score is computed from recorded scores every time the page loads. It is not stored, not
            generated, and not adjustable.
          </p>
        </div>
      </details>
    </div>
  );
}

function LuckNumber({ label, luck }: { label: string; luck: LuckScore }) {
  return (
    <div className="text-center">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      {luck.score == null ? (
        <>
          <p className="font-heading text-xl font-semibold text-muted-foreground">—</p>
          <p className="text-xs text-muted-foreground">not enough games</p>
        </>
      ) : (
        <>
          <p className={`font-heading text-3xl font-semibold tabular-nums ${toneFor(luck.score).split(" ").at(-1)}`}>
            {luck.score}
          </p>
          <p className="text-xs text-muted-foreground">{luck.label}</p>
          <p className="text-[11px] text-muted-foreground/80">{CONFIDENCE_TEXT[luck.confidence]}</p>
        </>
      )}
    </div>
  );
}
