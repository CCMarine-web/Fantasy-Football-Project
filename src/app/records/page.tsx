import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { getComputedRecords } from "@/server/repositories/computed-records-repository";
import { Award } from "lucide-react";

export const metadata = { title: "Records" };

export default async function RecordsPage() {
  const records = await getComputedRecords();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Ledger"
        title="League Records"
        description="Every record on the books, computed live across all synced seasons."
      />
      <div className="mt-8">
        {records.length === 0 ? (
          <EmptyState icon={Award} title="No records yet" description="Records populate once games have been played and synced." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {records.map((r) => (
              <Card key={r.key}>
                <CardContent>
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">{r.label}</p>
                  <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{r.value}</p>
                  <p className="mt-1 text-sm font-medium">
                    {r.holderManagerId ? (
                      <Link href={`/managers/${r.holderManagerId}`} className="hover:text-primary">
                        {r.holderName}
                      </Link>
                    ) : (
                      r.holderName
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.detail}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
