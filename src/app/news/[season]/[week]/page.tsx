import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getWeeklyRecap } from "@/server/repositories/news-repository";
import { Flame, Snowflake, Sparkles, Trophy } from "lucide-react";

export const metadata = { title: "Weekly Recap" };

const AWARD_ICONS: Record<string, typeof Flame> = {
  BOOM_OF_WEEK: Flame,
  BUST_OF_WEEK: Snowflake,
  BENCH_BLUNDER: Snowflake,
  LUCKIEST_WIN: Sparkles,
  UNLUCKIEST_LOSS: Trophy,
};

export default async function WeeklyRecapPage({
  params,
}: {
  params: Promise<{ season: string; week: string }>;
}) {
  const { season, week } = await params;
  const data = await getWeeklyRecap(Number(season), Number(week));
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold tracking-[0.2em] text-primary uppercase">
        {data.seasonYear} · Week {data.week}
      </p>
      <h1 className="mt-2 font-heading text-4xl font-semibold tracking-wide uppercase">
        {data.articleTitle ?? `Week ${data.week} Recap`}
      </h1>

      {/* Weekly awards */}
      {data.awards.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase text-primary">
            Weekly Awards
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.awards.map((a) => {
              const Icon = AWARD_ICONS[a.type] ?? Sparkles;
              return (
                <Card key={a.type}>
                  <CardContent className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                    <div>
                      <p className="text-xs tracking-wide text-muted-foreground uppercase">{a.label}</p>
                      <Link href={`/managers/${a.managerId}`} className="font-heading font-semibold hover:text-primary">
                        {a.managerName}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.description}</p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      <Separator className="my-8" />

      {/* Matchup results + recaps */}
      <section>
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase text-primary">
          Matchups
        </h2>
        <div className="space-y-4">
          {data.matchups.map((m) => (
            <Card key={m.matchupId}>
              <CardContent className="space-y-2">
                <div className="flex flex-col gap-1">
                  {m.teams.map((t) => (
                    <div key={t.managerId} className="flex items-center justify-between text-sm">
                      <Link
                        href={`/managers/${t.managerId}`}
                        className={t.isWinner ? "font-semibold hover:text-primary" : "text-muted-foreground hover:text-primary"}
                      >
                        {t.teamName}
                      </Link>
                      <span className={`font-mono ${t.isWinner ? "text-primary" : "text-muted-foreground"}`}>
                        {t.score?.toFixed(1) ?? "—"}
                      </span>
                    </div>
                  ))}
                </div>
                {m.recap ? (
                  <>
                    <Separator />
                    <p className="text-sm whitespace-pre-line text-foreground/90">{m.recap}</p>
                  </>
                ) : null}
                <Link
                  href={`/matchups/${data.seasonYear}/${data.week}/${m.matchupId}`}
                  className="inline-block text-xs text-primary hover:underline"
                >
                  Box score →
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
