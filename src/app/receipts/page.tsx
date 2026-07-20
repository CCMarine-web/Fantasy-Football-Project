import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollText, Flame } from "lucide-react";
import { listReceipts, getWorstTakeBySeason } from "@/server/repositories/receipts-repository";

export const metadata = { title: "Receipts" };

// Chat lore drives this page; keep it fresh rather than statically cached.
export const dynamic = "force-dynamic";

function attribution(managerName: string | null, timestamp: Date | null): string | null {
  const who = managerName ?? null;
  const when = timestamp ? timestamp.getUTCFullYear() : null;
  if (who && when) return `${who} · ${when}`;
  if (who) return who;
  if (when) return String(when);
  return null;
}

export default async function ReceiptsPage() {
  const [receipts, worstTakes] = await Promise.all([
    listReceipts({ approvedOnly: true }),
    getWorstTakeBySeason(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Rat Trap"
        title="Receipts"
        description="Bold takes, called shots, and guarantees — pulled from the group chat and paired with what actually happened."
      />

      {receipts.length === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={ScrollText}
            title="No receipts yet"
            description="Chat lore hasn't been imported. Once the group chat archives are uploaded and reviewed, every bold take shows up here with a verdict."
          />
        </div>
      ) : (
        <>
          {worstTakes.length > 0 ? (
            <section className="mt-10">
              <h2 className="font-heading mb-4 flex items-center gap-2 text-xl font-semibold tracking-wide uppercase">
                <Flame className="h-5 w-5 text-primary" aria-hidden />
                Worst Take of the Year
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {worstTakes.map((w) => (
                  <Card key={w.seasonId} className="border-primary/40">
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span>{w.seasonYear}</span>
                        <Badge variant="destructive">Worst Take</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p className="font-medium">&ldquo;{w.receipt.takeText}&rdquo;</p>
                      {attribution(w.receipt.managerName, w.receipt.messageTimestamp) ? (
                        <p className="text-xs text-muted-foreground">
                          {attribution(w.receipt.managerName, w.receipt.messageTimestamp)}
                        </p>
                      ) : null}
                      {w.receipt.outcomeText ? (
                        <p className="text-muted-foreground">
                          <span className="font-semibold text-foreground">What happened: </span>
                          {w.receipt.outcomeText}
                        </p>
                      ) : null}
                      {w.receipt.verdict ? (
                        <p className="italic text-primary">{w.receipt.verdict}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-10 space-y-4">
            <h2 className="font-heading text-xl font-semibold tracking-wide uppercase">The Ledger</h2>
            {receipts.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-2 py-5 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">&ldquo;{r.takeText}&rdquo;</p>
                    {r.seasonYear ? (
                      <Badge variant="outline" className="shrink-0">
                        {r.seasonYear}
                      </Badge>
                    ) : null}
                  </div>
                  {attribution(r.managerName, r.messageTimestamp) ? (
                    <p className="text-xs text-muted-foreground">
                      {attribution(r.managerName, r.messageTimestamp)}
                    </p>
                  ) : null}
                  {r.outcomeText ? (
                    <p className="text-muted-foreground">
                      <span className="font-semibold text-foreground">What happened: </span>
                      {r.outcomeText}
                    </p>
                  ) : null}
                  {r.verdict ? <p className="italic text-primary">{r.verdict}</p> : null}
                </CardContent>
              </Card>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
