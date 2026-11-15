import Link from "next/link";
import { heatColor } from "@/lib/chart-theme";
import type { PartnerCell } from "@/server/stats/trade-ledger";

/**
 * Who trades with whom: managers by managers, each cell the number of trades
 * between the pair. Hover (or a screen reader) gives the row manager's net
 * value across those trades.
 */
export function TradePartnerGrid({
  managers,
  cells,
}: {
  /** Sorted by name. */
  managers: { id: string; name: string }[];
  /** Keyed `${rowId}|${colId}`. */
  cells: Record<string, PartnerCell>;
}) {
  const max = Object.values(cells).reduce((m, c) => Math.max(m, c.trades), 0);
  const last = (name: string) => name.split(" ").slice(1).join(" ") || name;
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;

  return (
    <figure className="rounded-lg border border-border/60 bg-card/60 p-3 sm:p-4">
      <figcaption className="mb-2">
        <span className="block font-heading text-sm font-semibold tracking-wide uppercase">Trade partners</span>
        <span className="block text-xs text-muted-foreground">
          Trades between each pair; darker blue means they do business more often. Hover a cell for the row
          manager&rsquo;s net value against that partner. A dot is a pair that has never picked up the phone.
        </span>
      </figcaption>
      <div className="relative overflow-x-auto" role="region" aria-label="Trade partner grid, scrolls sideways" tabIndex={0}>
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card" />
              {managers.map((m) => (
                <th key={m.id} scope="col" className="w-12 px-0.5 text-center font-medium text-muted-foreground" title={m.name}>
                  {last(m.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {managers.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="sticky left-0 z-10 bg-card pr-2 text-left font-medium whitespace-nowrap">
                  <Link href={`/managers/${row.id}`} className="hover:text-primary">
                    {row.name}
                  </Link>
                </th>
                {managers.map((col) => {
                  if (row.id === col.id) return <td key={col.id} className="h-9 w-12 rounded bg-muted/20" aria-hidden />;
                  const cell = cells[`${row.id}|${col.id}`];
                  if (!cell) {
                    return (
                      <td key={col.id} className="h-9 w-12 rounded text-center text-muted-foreground/60">
                        <span aria-hidden>·</span>
                        <span className="sr-only">no trades</span>
                      </td>
                    );
                  }
                  const label = `${row.name} and ${col.name}: ${cell.trades} trade${cell.trades === 1 ? "" : "s"}, ${row.name} net ${signed(cell.net)}`;
                  return (
                    <td
                      key={col.id}
                      className="h-9 w-12 rounded text-center font-mono tabular-nums"
                      style={{ background: heatColor(50 + (50 * cell.trades) / Math.max(1, max)) }}
                      title={label}
                    >
                      <span aria-hidden>{cell.trades}</span>
                      <span className="sr-only">{label}</span>
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
