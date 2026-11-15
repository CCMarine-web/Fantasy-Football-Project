import { ChartFrame } from "@/components/charts/chart-frame";
import { SimpleBars } from "@/components/charts/charts";
import type { LedgerEntry } from "@/server/stats/trade-ledger";

/** "Michael Barkemeyer" -> "M. Barkemeyer": the axis has about a hundred pixels. */
function short(name: string): string {
  const parts = name.split(" ");
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(" ")}` : name;
}

/**
 * Net trade value per manager: value received minus value given, summed over
 * every trade. Bars diverge around zero; the league as a whole nets to zero,
 * so every point one manager is up, somebody else donated.
 */
export function TradeLedgerChart({
  ledger,
  names,
}: {
  ledger: LedgerEntry[];
  names: Record<string, string>;
}) {
  const best = ledger[0];
  const worst = ledger.at(-1);
  const name = (id: string) => names[id] ?? "Unknown";
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
  return (
    <ChartFrame
      title="The trade ledger"
      caption="Net value from every trade: what each manager received minus what he handed over, in the same position-adjusted points as the cards below. Right of zero is a shark; left of zero is a donor."
      summary={
        best && worst
          ? `Net trade value for ${ledger.length} managers. ${name(best.managerId)} leads at ${signed(best.net)}; ${name(worst.managerId)} trails at ${signed(worst.net)}.`
          : "No trades to tally."
      }
      table={{
        headers: ["Manager", "Trades", "Received", "Given", "Net"],
        rows: ledger.map((e) => [name(e.managerId), e.trades, e.received.toFixed(1), e.given.toFixed(1), signed(e.net)]),
      }}
      height="h-80"
    >
      <SimpleBars
        horizontal
        diverging
        data={ledger.map((e) => ({ label: short(name(e.managerId)), value: e.net }))}
        valueLabel="Net value"
        valueFormat="fixed1"
      />
    </ChartFrame>
  );
}
