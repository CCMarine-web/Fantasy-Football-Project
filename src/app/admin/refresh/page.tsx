import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { isAIConfigured, isSleeperConfigured } from "@/lib/env";
import { getSeasonPhase } from "@/server/repositories/season-phase";
import { WeeklyRefreshForm } from "./refresh-form";

export const metadata = { title: "Weekly Refresh" };

export const dynamic = "force-dynamic";

/** Env vars the job depends on. Names only — a value is never rendered. */
const ENV_VARS = [
  {
    name: "DATABASE_URL",
    what: "Supabase pooler connection. Everything is read from and written to it.",
    required: true,
  },
  {
    name: "SLEEPER_LEAGUE_ID",
    what: "The current season's Sleeper league. Without it the sync step is skipped, not failed.",
    required: false,
  },
  {
    name: "OPENAI_API_KEY",
    what: "Without it the writing step is skipped. Placeholder copy is never saved.",
    required: false,
  },
  {
    name: "CRON_SECRET",
    what: "When set, /api/cron/weekly requires it as a bearer token. Vercel Cron sends it automatically.",
    required: false,
  },
] as const;

export default async function AdminRefreshPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");

  const season =
    (await prisma.season.findFirst({ where: { isCurrent: true } })) ??
    (await prisma.season.findFirst({ orderBy: { year: "desc" } }));
  const phase = season ? await getSeasonPhase(season.id, season.year) : null;

  const recentRuns = await prisma.dataSyncLog.findMany({
    where: { syncType: "STATS_RECALC" },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      recordsProcessed: true,
      errorMessage: true,
      triggeredByUser: { select: { name: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Weekly Refresh"
        description="Sync the platform, recalculate the statistics, then write the week — in that order. The same job the cron runs."
        actions={
          <Button render={<Link href="/admin" />} nativeButton={false} variant="outline" size="sm">
            Back to dashboard
          </Button>
        }
      />

      <Card className="mt-8">
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">
              {season ? `${season.year} · ${phase?.label ?? season.status}` : "No season"}
            </Badge>
            <Badge
              variant={isSleeperConfigured() ? "default" : "outline"}
              className={isSleeperConfigured() ? "bg-field text-field-foreground" : ""}
            >
              {isSleeperConfigured() ? "Sleeper connected" : "Sleeper not configured"}
            </Badge>
            <Badge
              variant={isAIConfigured() ? "default" : "outline"}
              className={isAIConfigured() ? "bg-field text-field-foreground" : ""}
            >
              {isAIConfigured() ? "OpenAI connected" : "OpenAI not configured"}
            </Badge>
          </div>

          {phase && phase.phase !== "IN_SEASON" ? (
            <p className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {phase.phase === "PRESEASON"
                ? "The draft has not happened. A run will sync the platform (which is how the draft gets noticed) but will deliberately skip everything roster-dependent — no awards, no previews, no recaps."
                : "The draft is done and no week has been played. A run will sync rosters and refresh the rankings; there is still nothing to recap."}
            </p>
          ) : null}

          <WeeklyRefreshForm />
        </CardContent>
      </Card>

      <section className="mt-8">
        <h2 className="mb-2 font-heading text-lg font-semibold tracking-wide uppercase">Schedule</h2>
        <p className="text-sm text-muted-foreground">
          Configured in <code>vercel.json</code>:{" "}
          <code className="font-mono">0 12 * * 2</code> — every Tuesday at 12:00 UTC (about 07:00 US
          Central), well after Monday Night Football has finished and Sleeper has settled the week&rsquo;s
          scoring. Running earlier risks recapping a week that is not final.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          The job is idempotent: a duplicate firing, a manual run, or a retry after a timeout all
          converge on the same state. Transactions upsert on their Sleeper id, weekly awards upsert
          on (season, week, type), and a matchup that already has a preview or recap is left alone —
          so nothing is ever written twice.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-heading text-lg font-semibold tracking-wide uppercase">
          Environment variables
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Set these under Vercel → Settings → Environment Variables. Their values are never displayed
          here, logged, or included in an error message.
        </p>
        <dl className="space-y-2">
          {ENV_VARS.map((v) => (
            <div key={v.name} className="rounded-md border border-border/60 bg-card/30 px-3 py-2">
              <dt className="flex items-center gap-2 font-mono text-sm">
                {v.name}
                {v.required ? (
                  <Badge variant="destructive" className="text-[10px]">
                    required
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">
                    optional
                  </Badge>
                )}
              </dt>
              <dd className="text-xs text-muted-foreground">{v.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-heading text-lg font-semibold tracking-wide uppercase">
          Recent runs
        </h2>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No refresh has been recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {recentRuns.map((run) => (
              <li
                key={run.id}
                className="rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={run.status === "FAILED" ? "destructive" : "outline"}
                    className={run.status === "SUCCESS" ? "bg-field text-field-foreground" : ""}
                  >
                    {run.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {run.startedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {run.recordsProcessed ?? 0} step(s) succeeded ·{" "}
                    {run.triggeredByUser?.name ? `by ${run.triggeredByUser.name}` : "scheduled"}
                  </span>
                </div>
                {run.errorMessage ? (
                  <p className="mt-1 text-xs text-destructive">{run.errorMessage}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
