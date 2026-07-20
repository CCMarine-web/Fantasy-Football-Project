import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/auth";
import { listReceipts } from "@/server/repositories/receipts-repository";
import { ScanButton } from "./scan-button";
import {
  approveReceiptAction,
  rejectReceiptAction,
  setWorstTakeAction,
  saveOutcomeAction,
} from "./actions";

export const metadata = { title: "Review Receipts" };

export const dynamic = "force-dynamic";

const STATUS_VARIANT = {
  PENDING: "secondary",
  APPROVED: "outline",
  REJECTED: "destructive",
} as const;

export default async function AdminReceiptsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const receipts = await listReceipts();
  const pending = receipts.filter((r) => r.approvalStatus === "PENDING");
  const reviewed = receipts.filter((r) => r.approvalStatus !== "PENDING");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Review Receipts"
        description="Scan approved chat messages for bold takes, then approve, reject, and pair them with outcomes and a Worst-Take crown."
      />

      <div className="mt-8">
        <ScanButton />
      </div>

      <section className="mt-10">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Pending review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            description="Run a scan above. Bold takes found in approved, non-sensitive chat messages land here as PENDING receipts."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-3 py-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">&ldquo;{r.takeText}&rdquo;</p>
                    {r.seasonYear ? (
                      <Badge variant="outline" className="shrink-0">
                        {r.seasonYear}
                      </Badge>
                    ) : null}
                  </div>
                  {r.managerName ? (
                    <p className="text-xs text-muted-foreground">{r.managerName}</p>
                  ) : null}

                  <form action={saveOutcomeAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input
                      name="outcomeText"
                      defaultValue={r.outcomeText ?? ""}
                      placeholder="What actually happened…"
                      className="h-8 min-w-56 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    />
                    <button type="submit" className="text-xs font-medium text-primary hover:underline">
                      Save outcome + verdict
                    </button>
                  </form>
                  {r.verdict ? <p className="text-xs italic text-primary">{r.verdict}</p> : null}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <form action={approveReceiptAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-xs font-medium text-field hover:underline">
                        Approve
                      </button>
                    </form>
                    <form action={rejectReceiptAction}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-xs font-medium text-destructive hover:underline">
                        Reject
                      </button>
                    </form>
                    {r.seasonId ? (
                      <form action={setWorstTakeAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="seasonId" value={r.seasonId} />
                        <button type="submit" className="text-xs font-medium text-primary hover:underline">
                          Mark Worst Take {r.seasonYear ? `(${r.seasonYear})` : ""}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Reviewed ({reviewed.length})
        </h2>
        {reviewed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved or rejected receipts yet.</p>
        ) : (
          <div className="space-y-2">
            {reviewed.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
              >
                <span className="flex-1">
                  {r.isWorstTake ? <span title="Worst Take">🥇 </span> : null}
                  &ldquo;{r.takeText}&rdquo;
                </span>
                <Badge variant={STATUS_VARIANT[r.approvalStatus]}>{r.approvalStatus}</Badge>
                {r.approvalStatus === "APPROVED" && r.seasonId ? (
                  <form action={setWorstTakeAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="seasonId" value={r.seasonId} />
                    <button type="submit" className="text-xs font-medium text-primary hover:underline">
                      Worst Take
                    </button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
