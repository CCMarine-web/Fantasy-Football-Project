import { ChartFrame } from "@/components/charts/chart-frame";
import { MultiLineChart } from "@/components/charts/charts";
import type { TimelinePoint } from "@/server/stats/trade-ledger";

/**
 * One trade's running value for each side, week by week after the deal. The
 * repository re-runs the card's own valuation on each week's truncated window,
 * so the last point on each line is the "value received" on the card.
 */
export function TradeValueChart({
  timeline,
  sides,
  colors,
}: {
  timeline: TimelinePoint[];
  sides: { managerId: string; managerName: string; value: number }[];
  /** Manager id -> team colour, from teamColorMap over every manager. */
  colors: Record<string, string>;
}) {
  const first = timeline[0]?.week;
  const last = timeline.at(-1)?.week;
  const data = timeline.map((p) => {
    const row: Record<string, number> = { week: p.week };
    for (const s of sides) row[s.managerId] = p.values[s.managerId] ?? 0;
    return row;
  });
  // The palette wraps past ten managers; never draw both sides in one colour.
  const sameColor = sides.length === 2 && colors[sides[0].managerId] === colors[sides[1].managerId];

  return (
    <ChartFrame
      title="Value over time"
      caption="Each side's running value above replacement after every week since the deal. It is a per-game rate times games played, floored at zero, so one dud week can drag a line back down; playoff weeks count extra. The last point is the value on the card."
      summary={`Running trade value from week ${first} to week ${last}. ${sides.map((s) => `${s.managerName} finished at ${s.value.toFixed(1)}`).join("; ")}.`}
      table={{
        headers: ["Week", ...sides.map((s) => s.managerName)],
        rows: timeline.map((p) => [p.week, ...sides.map((s) => (p.values[s.managerId] ?? 0).toFixed(1))]),
      }}
      height="h-56"
      className="mt-2"
    >
      <MultiLineChart
        data={data}
        xKey="week"
        xLabel="Week"
        yLabel="Value"
        yFormat="fixed0"
        tooltipFormat="fixed1"
        series={sides.map((s, i) => ({
          key: s.managerId,
          label: s.managerName,
          color: colors[s.managerId] ?? "var(--primary)",
          dashed: sameColor && i === 1,
        }))}
      />
    </ChartFrame>
  );
}
