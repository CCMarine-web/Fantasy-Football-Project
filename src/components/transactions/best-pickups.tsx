import Link from "next/link";
import { ChartFrame } from "@/components/charts/chart-frame";
import { SimpleBars } from "@/components/charts/charts";
import { positionLabel } from "@/lib/format";
import type { PickupView } from "@/server/repositories/transaction-repository";

/** The bar axis has about a hundred pixels: "D. Maye", or "Seahawks" for a defense. */
function barLabel(p: PickupView): string {
  const parts = p.playerName.split(" ");
  if (parts.length < 2) return p.playerName;
  if (p.position === "DEF" || p.position === "DST") return parts.at(-1) as string;
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

/**
 * The ten waiver and free-agent adds that paid off most for the team that made
 * them: points scored in that team's starting lineup from the add until the
 * player left the roster. Bench points do not count; nobody won a week with them.
 */
export function BestPickups({
  pickups,
  seasonYear,
  colors,
}: {
  pickups: PickupView[];
  seasonYear: number;
  /** Manager id -> team colour. */
  colors: Record<string, string>;
}) {
  const top = pickups[0];
  return (
    <div className="space-y-3">
      <ChartFrame
        title={`Best pickups, ${seasonYear}`}
        caption="Starter points scored for the acquiring team after a waiver claim or free-agent add, until the player left that roster. Bars are coloured by manager."
        summary={
          top
            ? `Top ${pickups.length} pickups of ${seasonYear} by starter points. ${top.playerName} leads with ${top.starterPoints.toFixed(1)} for ${top.managerName}.`
            : "No pickups scored."
        }
        table={{
          headers: ["Player", "Manager", "How", "Added", "Weeks on roster", "Starts", "Starter points"],
          rows: pickups.map((p) => [
            `${p.playerName} (${positionLabel(p.position)})`,
            p.managerName,
            p.kind,
            `Week ${p.addedWeek}`,
            p.weeksOnRoster,
            p.startedWeeks,
            p.starterPoints.toFixed(1),
          ]),
        }}
        height="h-80"
      >
        <SimpleBars
          horizontal
          data={pickups.map((p) => ({ label: barLabel(p), value: p.starterPoints, color: colors[p.managerId] }))}
          valueLabel="Starter points"
          valueFormat="fixed0"
        />
      </ChartFrame>

      <div className="relative overflow-x-auto rounded-lg border border-border/60" role="region" aria-label="Best pickups table, scrolls sideways" tabIndex={0}>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border/60">
              <th scope="col" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">Player</th>
              <th scope="col" className="px-3 py-2 text-left font-medium">Manager</th>
              <th scope="col" className="px-3 py-2 text-left font-medium whitespace-nowrap">How</th>
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap">On roster</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Starts</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {pickups.map((p) => (
              <tr key={`${p.transactionId}-${p.playerId}`}>
                <th scope="row" className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium whitespace-nowrap">
                  {p.playerName} <span className="text-xs text-muted-foreground">{positionLabel(p.position)}</span>
                </th>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: colors[p.managerId] }} aria-hidden />
                  <Link href={`/managers/${p.managerId}`} className="hover:text-primary">
                    {p.managerName}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {p.kind}, wk {p.addedWeek}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-muted-foreground">
                  {p.startWeek === p.endWeek ? `wk ${p.startWeek}` : `wks ${p.startWeek}–${p.endWeek}`}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{p.startedWeeks}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{p.starterPoints.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
