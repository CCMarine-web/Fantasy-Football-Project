import Link from "next/link";
import { heatColor } from "@/lib/chart-theme";
import { managerPath } from "@/lib/slug";
import { rivalryPath } from "@/lib/rivalry-slug";
import type { RivalryView } from "@/server/repositories/computed-rivalries-repository";

/**
 * Every pair at a glance: rows are the manager, columns the opponent, each cell
 * the row manager's record against the column manager, coloured by win % (blue
 * winning, orange losing). Click a cell for that rivalry.
 */
export function RivalryGrid({ rivalries }: { rivalries: RivalryView[] }) {
  const people = new Map<string, string>();
  for (const r of rivalries) {
    people.set(r.managerAId, r.managerAName);
    people.set(r.managerBId, r.managerBName);
  }
  const ids = [...people.keys()].sort((a, b) => (people.get(a) as string).localeCompare(people.get(b) as string));
  const find = (x: string, y: string) => rivalries.find((r) => (r.managerAId === x && r.managerBId === y) || (r.managerAId === y && r.managerBId === x));
  const last = (name: string) => name.split(" ").slice(1).join(" ") || name;

  return (
    <figure className="rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4">
      <figcaption className="mb-2">
        <span className="block font-heading text-sm font-semibold tracking-wide uppercase">Head-to-head grid</span>
        <span className="block text-xs text-muted-foreground">
          Each cell is the row manager&rsquo;s record against the column manager (regular season and championship bracket). Blue = winning the series, orange = losing it.
        </span>
      </figcaption>
      <div className="relative overflow-x-auto" role="region" aria-label="Head-to-head grid, scrolls sideways" tabIndex={0}>
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card" />
              {ids.map((id) => (
                <th key={id} scope="col" className="w-14 px-0.5 text-center font-medium text-muted-foreground" title={people.get(id)}>
                  {last(people.get(id) as string)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ids.map((row) => (
              <tr key={row}>
                <th scope="row" className="sticky left-0 z-10 bg-card pr-2 text-left font-medium whitespace-nowrap">
                  <Link href={managerPath(people.get(row) as string)} className="hover:text-primary">
                    {people.get(row)}
                  </Link>
                </th>
                {ids.map((col) => {
                  if (row === col) return <td key={col} className="h-9 w-14 rounded bg-muted/20" aria-hidden />;
                  const r = find(row, col);
                  if (!r || r.gamesPlayed === 0) return <td key={col} className="h-9 w-14 rounded text-center text-muted-foreground">—</td>;
                  const w = r.managerAId === row ? r.managerAWins : r.managerBWins;
                  const l = r.managerAId === row ? r.managerBWins : r.managerAWins;
                  const pct = ((w + 0.5 * r.ties) / r.gamesPlayed) * 100;
                  return (
                    <td key={col} className="h-9 w-14 rounded p-0 text-center" style={{ background: heatColor(pct) }}>
                      <Link
                        href={rivalryPath(r.managerAName, r.managerBName)}
                        className="flex h-full w-full items-center justify-center font-mono tabular-nums hover:outline hover:outline-2 hover:outline-primary"
                        title={`${people.get(row)} vs ${people.get(col)}: ${w}-${l}${r.ties ? `-${r.ties}` : ""} over ${r.gamesPlayed} meetings`}
                      >
                        {w}-{l}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
