import Link from "next/link";
import { formatOdds } from "@/lib/format";
import { Trophy } from "lucide-react";
import { managerPath } from "@/lib/slug";
import type { StandingsRow } from "@/types/view-models";

/**
 * The playoff race in one strip: in / bubble / out, with each team's simulated
 * playoff odds (the same 10,000-run simulation as /standings).
 *   in      clinched, or 95%+
 *   bubble  5% to 95%
 *   out     eliminated, or under 5%
 */
export function PlayoffRace({ rows }: { rows: StandingsRow[] }) {
  const withOdds = rows.filter((r) => r.odds);
  const group = (r: StandingsRow) =>
    r.odds!.clinched || r.odds!.playoffPct >= 95 ? "in" : r.odds!.eliminated || r.odds!.playoffPct < 5 ? "out" : "bubble";
  const groups = [
    { key: "in", label: "In", tone: "border-field/50 bg-field/10" },
    { key: "bubble", label: "On the bubble", tone: "border-primary/40 bg-primary/5" },
    { key: "out", label: "Out", tone: "border-destructive/40 bg-destructive/5" },
  ] as const;
  const pct = (v: number, c?: { clinched?: boolean; eliminated?: boolean }) => formatOdds(v, c);
  return (
    <section aria-labelledby="playoff-race">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="playoff-race" className="flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
          <Trophy className="h-4 w-4 text-primary" aria-hidden /> Playoff race
        </h2>
        <Link href="/standings" className="text-sm text-primary hover:underline">
          Odds &amp; standings →
        </Link>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {groups.map((g) => {
          const members = withOdds.filter((r) => group(r) === g.key).sort((a, b) => b.odds!.playoffPct - a.odds!.playoffPct);
          return (
            <div key={g.key} className={`rounded-lg border p-3 ${g.tone}`}>
              <p className="mb-2 text-xs font-semibold tracking-wide uppercase">
                {g.label} <span className="text-muted-foreground">({members.length})</span>
              </p>
              <ul className="space-y-1 text-sm">
                {members.length === 0 ? <li className="text-muted-foreground">—</li> : null}
                {members.map((r) => (
                  <li key={r.fantasyTeamId} className="flex items-center justify-between gap-2">
                    <Link href={managerPath(r.managerName)} className="min-w-0 truncate hover:text-primary" title={r.teamName}>
                      {r.managerName}
                      {r.odds!.clinched ? <span className="ml-1 text-xs text-field">x</span> : r.odds!.eliminated ? <span className="ml-1 text-xs text-destructive">e</span> : null}
                    </Link>
                    <span className="shrink-0 font-mono text-xs tabular-nums">
                      {r.wins}-{r.losses} · {pct(r.odds!.playoffPct, r.odds!)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Playoff odds from 10,000 simulations of the remaining schedule.
        {withOdds.some((r) => r.odds!.clinched || r.odds!.eliminated) ? " x = clinched, e = eliminated." : ""}
      </p>
    </section>
  );
}
