import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { listTransactions } from "@/server/repositories/transaction-repository";
import { ArrowRightLeft } from "lucide-react";

export const metadata = { title: "Transactions" };

const TYPES = ["WAIVER", "FREE_AGENT", "TRADE", "COMMISSIONER"] as const;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; week?: string; type?: string }>;
}) {
  const { season, week, type } = await searchParams;

  const transactions = await listTransactions({
    seasonYear: season ? Number(season) : undefined,
    week: week ? Number(week) : undefined,
    type: type && TYPES.includes(type as (typeof TYPES)[number]) ? (type as (typeof TYPES)[number]) : undefined,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Wire"
        title="Transactions"
        description="Every add, drop, waiver claim, and trade — filterable by season, week, and type."
      />

      <form className="mt-8 flex flex-wrap items-end gap-4 rounded-lg border border-border/60 bg-card/30 p-4">
        <div className="space-y-1">
          <Label htmlFor="season">Season</Label>
          <Input id="season" name="season" type="number" defaultValue={season} placeholder="2024" className="w-28" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="week">Week</Label>
          <Input id="week" name="week" type="number" defaultValue={week} placeholder="1" className="w-20" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ""}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Filter
        </Button>
      </form>

      <div className="mt-8 space-y-3">
        {transactions.length === 0 ? (
          <EmptyState icon={ArrowRightLeft} title="No transactions match these filters" />
        ) : (
          transactions.map((tx) => (
            <Card key={tx.id}>
              <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {tx.type.replace("_", " ")}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {tx.season.year}
                      {tx.week ? ` · Week ${tx.week}` : ""}
                    </span>
                    {tx.faabSpent ? (
                      <Badge variant="secondary" className="text-[10px]">
                        ${tx.faabSpent} FAAB
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">
                    {tx.assets.map((a, i) => (
                      <span key={a.id}>
                        {i > 0 ? ", " : ""}
                        <span className={a.direction === "ADD" ? "text-field" : "text-destructive"}>
                          {a.direction === "ADD" ? "+" : "−"}
                        </span>{" "}
                        {a.player ? `${a.player.firstName} ${a.player.lastName}` : "—"}
                        <span className="text-muted-foreground"> ({a.fantasyTeam.teamName})</span>
                      </span>
                    ))}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
