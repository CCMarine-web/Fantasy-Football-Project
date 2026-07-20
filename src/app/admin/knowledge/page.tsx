import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/auth";
import { PrivacyStatus, SensitivityStatus } from "@/generated/prisma/client";
import {
  listLeagueKnowledge,
  type KnowledgeView,
} from "@/server/repositories/admin-review-repository";
import { KnowledgeEditor } from "./knowledge-editor";
import {
  approveKnowledgeAction,
  rejectKnowledgeAction,
  setPrivacyAction,
  markSensitiveAction,
} from "./actions";

export const metadata = { title: "Review League Knowledge" };

export const dynamic = "force-dynamic";

const PRIVACY_VALUES = Object.values(PrivacyStatus);
const SENSITIVITY_VALUES = Object.values(SensitivityStatus);

const STATUS_VARIANT = {
  PENDING: "secondary",
  APPROVED: "outline",
  REJECTED: "destructive",
} as const;

const PRIVACY_VARIANT = {
  PUBLIC_SAFE: "outline",
  PRIVATE: "secondary",
  NEVER_PUBLISH: "destructive",
} as const;

export default async function AdminKnowledgePage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const knowledge = await listLeagueKnowledge();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Review League Knowledge"
        description="Distilled traits, rivalries, jokes, and events proposed from chat/history evidence. Only APPROVED + PUBLIC_SAFE records ever feed public AI content."
      />

      <section className="mt-8">
        {knowledge.length === 0 ? (
          <EmptyState
            title="No knowledge extracted yet"
            description="Knowledge extraction runs later. Proposed records will appear here for review, privacy, and approval."
          />
        ) : (
          <div className="space-y-3">
            {knowledge.map((k) => (
              <KnowledgeCard key={k.id} item={k} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function KnowledgeCard({ item }: { item: KnowledgeView }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{item.knowledgeType}</Badge>
          <Badge variant={STATUS_VARIANT[item.approvalStatus]}>{item.approvalStatus}</Badge>
          <Badge variant={PRIVACY_VARIANT[item.privacyStatus]}>{item.privacyStatus}</Badge>
          {item.sensitivity !== "NONE" ? (
            <Badge variant="destructive">{item.sensitivity}</Badge>
          ) : null}
          <span className="text-xs text-muted-foreground">
            confidence {item.confidence.toFixed(2)}
          </span>
        </div>

        {item.managerNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {item.managerNames.map((name) => (
              <Badge key={name} variant="outline" className="text-[10px]">
                {name}
              </Badge>
            ))}
          </div>
        ) : null}

        <KnowledgeEditor id={item.id} title={item.title} body={item.body} />

        <details className="rounded-md border border-border/60 bg-card/30 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-primary">
            View evidence ({item.evidenceCount})
          </summary>
          {item.evidence.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No evidence attached.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {item.evidence.map((e) => (
                <li key={e.id} className="border-l-2 border-border/60 pl-2 text-xs">
                  {e.note ? <p className="text-muted-foreground">{e.note}</p> : null}
                  {e.chatMessageText ? (
                    <p className="italic">&ldquo;{e.chatMessageText}&rdquo;</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </details>

        <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
          <form action={approveKnowledgeAction}>
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className="text-xs font-medium text-field hover:underline">
              Approve
            </button>
          </form>
          <form action={rejectKnowledgeAction}>
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className="text-xs font-medium text-destructive hover:underline">
              Reject
            </button>
          </form>
          <form action={setPrivacyAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={item.id} />
            <select
              name="privacyStatus"
              defaultValue={item.privacyStatus}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {PRIVACY_VALUES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <button type="submit" className="text-xs font-medium text-primary hover:underline">
              Set privacy
            </button>
          </form>
          <form action={markSensitiveAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={item.id} />
            <select
              name="sensitivity"
              defaultValue={item.sensitivity}
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
