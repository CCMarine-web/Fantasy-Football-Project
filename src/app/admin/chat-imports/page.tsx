import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { auth } from "@/auth";
import {
  listChatImports,
  getLatestChatImportDetail,
  listManagerOptions,
  type ManagerOption,
} from "@/server/repositories/admin-review-repository";
import { mapParticipantAction } from "./actions";

export const metadata = { title: "Chat Imports" };

export const dynamic = "force-dynamic";

export default async function AdminChatImportsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const [imports, latest, managers] = await Promise.all([
    listChatImports(),
    getLatestChatImportDetail(),
    listManagerOptions(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Chat Imports"
        description="Bulk group-chat imports and their parse results. Resolve unmapped participants to managers below."
      />

      <section className="mt-8">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Imports ({imports.length})
        </h2>
        {imports.length === 0 ? (
          <EmptyState
            title="No imports yet"
            description="Group-chat imports will appear here once they are uploaded and parsed."
          />
        ) : (
          <div className="space-y-2">
            {imports.map((imp) => (
              <div
                key={imp.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate font-medium" title={imp.originalFileName}>
                  {imp.originalFileName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {imp.messageCount ?? 0} msgs · {imp.createdAt.toLocaleDateString()}
                </span>
                <Badge variant="outline">{imp.status}</Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      {latest ? (
        <section className="mt-10">
          <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
            Most recent import
          </h2>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total messages" value={latest.totalMessages} />
            <StatCard label="Pending" value={latest.pendingMessages} />
            <StatCard label="Approved" value={latest.approvedMessages} />
            <StatCard label="Low confidence" value={latest.lowConfidenceMessages} hint="< 0.6" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="uppercase">Participants</CardTitle>
              <CardDescription>
                Map each unresolved sender to a manager. Saving remembers the mapping for future
                imports and back-fills this import&apos;s messages.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {latest.participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No participants in this import.</p>
              ) : (
                <div className="space-y-2">
                  {latest.participants.map((p) => (
                    <form
                      key={p.id}
                      action={mapParticipantAction}
                      className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
                    >
                      <input type="hidden" name="participantId" value={p.id} />
                      <span className="min-w-40 flex-1 font-mono text-xs">{p.rawIdentifier}</span>
                      <span className="text-xs text-muted-foreground">{p.messageCount} msgs</span>
                      {p.linkedManagerName ? (
                        <Badge variant="outline">{p.linkedManagerName}</Badge>
                      ) : (
                        <Badge variant="destructive">UNRESOLVED</Badge>
                      )}
                      <ManagerSelect managers={managers} value={p.linkedManagerId} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Map
                      </button>
                    </form>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/30 px-3 py-3">
      <p className="text-xs text-muted-foreground">
        {label}
        {hint ? <span className="ml-1">({hint})</span> : null}
      </p>
      <p className="font-heading text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ManagerSelect({ managers, value }: { managers: ManagerOption[]; value: string | null }) {
  return (
    <select
      name="managerId"
      defaultValue={value ?? ""}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value="">(pick a manager)</option>
      {managers.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
