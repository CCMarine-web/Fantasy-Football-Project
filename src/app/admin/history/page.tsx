import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/auth";
import { SensitivityStatus } from "@/generated/prisma/client";
import {
  listHistorySections,
  type HistorySectionView,
} from "@/server/repositories/admin-review-repository";
import { HistoryEditor } from "./history-editor";
import {
  approveHistoryAction,
  rejectHistoryAction,
  markSensitivityAction,
} from "./actions";

export const metadata = { title: "Review League History" };

export const dynamic = "force-dynamic";

const SENSITIVITY_VALUES = Object.values(SensitivityStatus);

const STATUS_VARIANT = {
  PENDING: "secondary",
  APPROVED: "outline",
  REJECTED: "destructive",
} as const;

export default async function AdminHistoryPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const sections = await listHistorySections();
  const pending = sections.filter((s) => s.approvalStatus === "PENDING");
  const reviewed = sections.filter((s) => s.approvalStatus !== "PENDING");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Review League History"
        description="Structured slices of the commissioner's written history. Edit the text, mark sensitivity, then approve or reject."
      />

      <section className="mt-8">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Needs review ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <EmptyState
            title="Nothing pending"
            description="Imported history sections awaiting review will appear here."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((s) => (
              <HistoryCard key={s.id} section={s} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Reviewed ({reviewed.length})
        </h2>
        {reviewed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No approved or rejected sections yet.</p>
        ) : (
          <div className="space-y-3">
            {reviewed.map((s) => (
              <HistoryCard key={s.id} section={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function HistoryCard({ section }: { section: HistorySectionView }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{section.year ?? "—"}</Badge>
          <Badge variant="secondary">{section.sectionType}</Badge>
          <Badge variant={STATUS_VARIANT[section.approvalStatus]}>{section.approvalStatus}</Badge>
          {section.sensitivity !== "NONE" ? (
            <Badge variant="destructive">{section.sensitivity}</Badge>
          ) : null}
          {section.managerName ? (
            <span className="text-xs text-muted-foreground">{section.managerName}</span>
          ) : null}
        </div>

        <HistoryEditor id={section.id} title={section.title} body={section.body} />

        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <form action={approveHistoryAction}>
            <input type="hidden" name="id" value={section.id} />
            <button type="submit" className="text-xs font-medium text-field hover:underline">
              Approve
            </button>
          </form>
          <form action={rejectHistoryAction}>
            <input type="hidden" name="id" value={section.id} />
            <button type="submit" className="text-xs font-medium text-destructive hover:underline">
              Reject
            </button>
          </form>
          <form action={markSensitivityAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={section.id} />
            <select
              name="sensitivity"
              defaultValue={section.sensitivity}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {SENSITIVITY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button type="submit" className="text-xs font-medium text-primary hover:underline">
              Set sensitivity
            </button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
