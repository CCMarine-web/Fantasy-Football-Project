import { renderAtRequestIfNoDatabase } from "@/server/build-guard";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ChartFrame } from "@/components/charts/chart-frame";
import { RecordCard } from "@/components/records/record-card";
import { ScoreHistogramChart, type HistogramBin } from "@/components/records/score-histogram-chart";
import {
  getComputedRecords,
  getRecordWatch,
  getScoreDistribution,
} from "@/server/repositories/computed-records-repository";
import { RecordWatch } from "@/components/shared/record-watch";
import { Award } from "lucide-react";

/**
 * Pre-rendered (ISR). The data changes when the pipeline runs, and the pipeline
 * revalidates every page when it does; the hour is only a safety net.
 */
export const revalidate = 3600;

export const metadata = { title: "Records" };

export default async function RecordsPage() {
  // Pre-rendered when the build can reach the database; otherwise rendered per request.
  await renderAtRequestIfNoDatabase();
  // The Closest Game detail is already printed to two decimals under a point
  // (computed-records-repository), so no second lookup is needed here.
  const [records, watch, dist] = await Promise.all([getComputedRecords(), getRecordWatch(), getScoreDistribution()]);
  const binOf = (score: number) => Math.floor(score / 10) * 10;
  const bins: HistogramBin[] = !dist ? [] : dist.bins.map((b) => {
    const isHigh = binOf(dist.high.score) === b.from;
    const isLow = binOf(dist.low.score) === b.from;
    return {
      label: String(b.from),
      from: b.from,
      to: b.to,
      count: b.count,
      mark: isHigh ? "high" : isLow ? "low" : null,
      markLabel: isHigh
        ? `Record high: ${dist.high.score.toFixed(1)}, ${dist.high.managerName}, Wk ${dist.high.week} ${dist.high.year}`
        : isLow
          ? `Record low: ${dist.low.score.toFixed(1)}, ${dist.low.managerName}, Wk ${dist.low.week} ${dist.low.year}`
          : null,
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader art="header-records" freshness
        eyebrow="The Ledger"
        title="League Records"
        description="Every record on the books, computed live across all synced seasons."
      />

      {/*
       * What "all games" means here, said once. Single-game and streak records
       * span every game a manager played — a title-game score is still a score
       * — but season records are the regular season, because that is what a
       * season row is. Saying so is the difference between a record book and a
       * pile of numbers.
       */}
      <p className="mt-4 max-w-prose text-sm text-muted-foreground">
        Single-game and streak records count <strong className="text-foreground">every game</strong>{" "}
        a manager has played, regular season and postseason alike, and the detail line names the week.
        Season records — most points, best and worst record — are the{" "}
        <strong className="text-foreground">regular season</strong>, matching the season tables
        elsewhere on the site. Scores that could not be verified as real contest results are excluded;
        see the Hall of Shame for what that covers.
      </p>

      {watch && watch.items.length > 0 ? (
        <RecordWatch className="mt-8" seasonYear={watch.seasonYear} items={watch.items} />
      ) : null}

      <div className="mt-8">
        {records.length === 0 ? (
          <EmptyState icon={Award} title="No records yet" description="Records populate once games have been played and synced." />
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {records.map((r) => (
              <RecordCard key={r.key} record={r} />
            ))}
          </div>
        )}
      </div>

      {dist ? (
        <section className="mt-12">
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
            Every Score Ever
          </h2>
          <ChartFrame
            title="Weekly scores, all-time"
            caption={
              <>
                All {dist.total.toLocaleString()} verified scores from head-to-head games, in 10-point bins. Median{" "}
                {dist.median.toFixed(1)}, mean {dist.mean.toFixed(1)}. The red bin holds the record low (
                {dist.low.score.toFixed(1)}, {dist.low.managerName}), the green one the record high (
                {dist.high.score.toFixed(1)}, {dist.high.managerName}). The league wasn&apos;t PPR until 2019, and
                the two seasons before it averaged under 100 a week, so they fatten the left side.
              </>
            }
            summary={`Histogram of ${dist.total} weekly scores from ${dist.bins[0]?.from} to ${dist.bins[dist.bins.length - 1]?.to} points. Median ${dist.median.toFixed(1)}. Record low ${dist.low.score.toFixed(1)} by ${dist.low.managerName} in week ${dist.low.week} of ${dist.low.year}; record high ${dist.high.score.toFixed(1)} by ${dist.high.managerName} in week ${dist.high.week} of ${dist.high.year}.`}
            table={{
              headers: ["Points", "Scores", "Note"],
              rows: bins.map((b) => [`${b.from}–${(b.to - 0.01).toFixed(2)}`, b.count, b.markLabel ?? ""]),
            }}
          >
            <ScoreHistogramChart bins={bins} median={dist.median} />
          </ChartFrame>
        </section>
      ) : null}
    </div>
  );
}
