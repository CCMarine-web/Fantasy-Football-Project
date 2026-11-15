import Link from "next/link";
import { managerPath } from "@/lib/slug";
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
 * player left the roster, ABOVE what a replacement-level player at the same
 * position would have scored in those starts (the Trade Tribunal's measure).
 * Bench points do not count; nobody won a week with them.
 */
export function BestPickups({
  pickups,
  seasonYear,
  colors,
  replacement,
}: {
  pickups: PickupView[];
  seasonYear: number;
  /** Replacement level per position, points per game. */
  replacement: string;
  /** Manager id -> team colour. */
  colors: Record<string, string>;
}) {
  const top = pickups[0];
  return (
    <div className="space-y-3">
      <ChartFrame
        title={`Best pickups, ${seasonYear}`}
        caption="Starter points for the acquiring team after a waiver claim or free-agent add, above what a replacement-level player at the same position would have scored in those starts. Bars are coloured by manager."
        summary={
          top
            ? `Top ${pickups.length} pickups of ${seasonYear} by starter points above replacement. ${top.playerName} leads with +${top.aboveReplacement.toFixed(1)} for ${top.managerName}.`
            : "No pickups scored."
        }
        table={{
          headers: ["Player", "Manager", "How", "Added", "Weeks on roster", "Starts", "Starter points", "Above replacement"],
          rows: pickups.map((p) => [
            `${p.playerName} (${positionLabel(p.position)})`,
            p.managerName,
            p.kind,
            `Week ${p.addedWeek}`,
            p.weeksOnRoster,
            p.startedWeeks,
            p.starterPoints.toFixed(1),
            p.aboveReplacement.toFixed(1),
          ]),
        }}
        height="h-80"
      >
        <SimpleBars
          horizontal
          data={pickups.map((p) => ({ label: barLabel(p), value: p.aboveReplacement, color: colors[p.managerId] }))}
          valueLabel="Points above replacement"
          valueFormat="fixed0"
        />
      </ChartFrame>
      {replacement ? (
        <p className="text-xs text-muted-foreground">
          Replacement level, points per game: <span className="font-mono">{replacement}</span>.
        </p>
      ) : null}

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
              <th scope="col" className="px-3 py-2 text-right font-medium whitespace-nowrap" title="Starter points minus a replacement-level player at the same position over the same starts">
                Above repl.
              </th>
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
                  <Link href={managerPath(p.managerName)} className="hover:text-primary">
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
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{p.starterPoints.toFixed(1)}</td>
                <td
                  className="px-3 py-2 text-right font-medium tabular-nums"
                  title={p.replacementPpg != null ? `Replacement ${positionLabel(p.position)}: ${p.replacementPpg} pts/gm × ${p.startedWeeks} starts` : undefined}
                >
                  +{p.aboveReplacement.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
