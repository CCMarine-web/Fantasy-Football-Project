import { Crown, Swords } from "lucide-react";
import { ManagerLink } from "@/components/shared/manager-link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LINEAL_BELT_RULE, type BeltReign, type LinealBelt } from "@/server/stats/lineal-belt";

const when = (year: number | null, week: number | null) => (year == null || week == null ? "—" : `Wk ${week}, ${year}`);
const score = (s: [number, number] | null) => (s ? `${s[0].toFixed(1)}–${s[1].toFixed(1)}` : "");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How a reign began: the opening title game, or the win that took the belt. */
function wonLine(r: BeltReign, firstTitleYear: number): string {
  return r.wonFromName
    ? `beat ${r.wonFromName} ${score(r.wonScore)}`
    : `won the ${firstTitleYear} title game`;
}

const VISIBLE_REIGNS = 10;

function ReignRow({ r, firstTitleYear }: { r: BeltReign; firstTitleYear: number }) {
  return (
    <tr className={r.isCurrent ? "bg-primary/10" : undefined}>
      <td className="px-2 py-2 sm:px-3">
        <ManagerLink managerId={r.holderId} name={r.holderName}>
          {r.holderName}
        </ManagerLink>
        {r.isCurrent ? (
          <Badge className="ml-2 align-middle text-[10px]">Holder</Badge>
        ) : null}
      </td>
      <td className="px-2 py-2 sm:px-3">
        <span className="whitespace-nowrap">{when(r.startYear, r.startWeek)}</span>
        <span className="block text-xs text-muted-foreground">{wonLine(r, firstTitleYear)}</span>
      </td>
      <td className="px-2 py-2 sm:px-3">
        {r.isCurrent ? (
          <span className="text-muted-foreground">Still wearing it</span>
        ) : (
          <>
            <span className="whitespace-nowrap">{when(r.endYear, r.endWeek)}</span>
            <span className="block text-xs text-muted-foreground">
              lost to {r.lostToName} {score(r.lostScore)}
            </span>
          </>
        )}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums sm:px-3">{r.defenses}</td>
    </tr>
  );
}

function ReignTable({ reigns, firstTitleYear }: { reigns: BeltReign[]; firstTitleYear: number }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-2 py-2 text-left sm:px-3">Holder</th>
            <th className="px-2 py-2 text-left sm:px-3">From</th>
            <th className="px-2 py-2 text-left sm:px-3">To</th>
            <th className="px-2 py-2 text-right sm:px-3">Defenses</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {reigns.map((r) => (
            <ReignRow key={`${r.holderId}-${r.startYear}-${r.startWeek}`} r={r} firstTitleYear={firstTitleYear} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The lineal belt on /championship-belt: current holder, longest reign(s),
 * the full timeline (latest ten, the rest behind a native <details>), and
 * belt time by manager. Everything comes from computeLinealBelt.
 */
export function LinealBeltSection({ belt }: { belt: LinealBelt }) {
  const newestFirst = [...belt.reigns].reverse();
  const recent = newestFirst.slice(0, VISIBLE_REIGNS);
  const older = newestFirst.slice(VISIBLE_REIGNS);
  const c = belt.current;
  const firstTitleYear = belt.start.year;
  const longestShared = belt.longest.length > 1;
  return (
    <section className="mt-12">
      <h2 className="mb-2 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
        <Swords className="h-5 w-5 shrink-0" /> The Lineal Belt
      </h2>
      <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
        The trophy is decided once a year. This one is on the line every week. {LINEAL_BELT_RULE} It has changed
        hands {plural(belt.reigns.length - 1, "time")} since {belt.start.managerName} picked it up in{" "}
        {firstTitleYear}.
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="border-primary/30">
          <CardContent>
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.2em] text-primary uppercase">
              <Crown className="h-4 w-4" /> Current holder
            </p>
            <p className="mt-1 font-heading text-2xl font-semibold">
              <ManagerLink managerId={c.holderId} name={c.holderName}>
                {c.holderName}
              </ManagerLink>
            </p>
            <p className="text-sm text-muted-foreground">
              Since {when(c.startYear, c.startWeek)} ({wonLine(c, firstTitleYear)}) ·{" "}
              {plural(c.defenses, "successful defense")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              Longest reign{longestShared ? "s (shared record)" : ""}
            </p>
            <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">
              {plural(belt.longest[0]?.defenses ?? 0, "defense")}
            </p>
            <ul className="mt-1 space-y-0.5 text-sm">
              {belt.longest.map((r) => (
                <li key={`${r.holderId}-${r.startYear}-${r.startWeek}`}>
                  <span className="font-medium">{r.holderName}</span>{" "}
                  <span className="text-muted-foreground">
                    {when(r.startYear, r.startWeek)} → {r.isCurrent ? "still going" : when(r.endYear, r.endWeek)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <h3 className="mt-6 mb-2 text-sm font-semibold tracking-wide uppercase">Every reign, newest first</h3>
      <ReignTable reigns={recent} firstTitleYear={firstTitleYear} />
      {older.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-primary select-none hover:underline">
            Show the {older.length} earlier reigns
          </summary>
          <div className="mt-3">
            <ReignTable reigns={older} firstTitleYear={firstTitleYear} />
          </div>
        </details>
      ) : null}

      <h3 className="mt-6 mb-2 text-sm font-semibold tracking-wide uppercase">Belt time by manager</h3>
      <div className="relative overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-2 py-2 text-left sm:px-3">Manager</th>
              <th className="px-2 py-2 text-right sm:px-3">Reigns</th>
              <th className="px-2 py-2 text-right sm:px-3">Defenses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {belt.byManager.map((m) => (
              <tr key={m.managerId}>
                <td className="px-2 py-2 sm:px-3">
                  <ManagerLink managerId={m.managerId} name={m.managerName}>
                    {m.managerName}
                  </ManagerLink>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums sm:px-3">{m.reigns}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums sm:px-3">{m.defenses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
