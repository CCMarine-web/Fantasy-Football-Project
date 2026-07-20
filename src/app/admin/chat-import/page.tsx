import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { listChatIdentityMappings } from "@/server/chat-import/backfill-service";
import { ImportForm } from "./import-form";
import { saveMappingAction } from "./actions";

export const metadata = { title: "Chat Import" };

export const dynamic = "force-dynamic";

interface ManagerOption {
  id: string;
  displayName: string;
}

/** Distinct raw identifier across all imports, with its current linked manager (if any). */
interface DistinctParticipant {
  rawIdentifier: string;
  linkedManagerId: string | null;
}

export default async function AdminChatImportPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const [managers, participants, mappings, importCount] = await Promise.all([
    prisma.manager.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    prisma.chatParticipant.findMany({
      select: { rawIdentifier: true, linkedManagerId: true },
      orderBy: { rawIdentifier: "asc" },
    }),
    listChatIdentityMappings(),
    prisma.chatImport.count(),
  ]);

  // Collapse participants to distinct raw identifiers (they recur across imports).
  const distinctByRaw = new Map<string, DistinctParticipant>();
  for (const p of participants) {
    const existing = distinctByRaw.get(p.rawIdentifier);
    if (!existing) {
      distinctByRaw.set(p.rawIdentifier, { rawIdentifier: p.rawIdentifier, linkedManagerId: p.linkedManagerId });
    } else if (!existing.linkedManagerId && p.linkedManagerId) {
      existing.linkedManagerId = p.linkedManagerId;
    }
  }
  const distinctParticipants = [...distinctByRaw.values()];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Chat Import"
        description="Bulk-import group-chat exports. Mappings are remembered across imports and overlapping exports are de-duplicated automatically."
      />

      <section className="mt-8">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">Run an import</h2>
        <ImportForm />
        <p className="mt-2 text-xs text-muted-foreground">{importCount} import(s) so far.</p>
      </section>

      <section className="mt-10">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Participant → Manager
        </h2>
        {distinctParticipants.length === 0 ? (
          <EmptyState
            title="No participants yet"
            description="Run an import above. Every distinct sender will show up here to be linked to a manager."
          />
        ) : (
          <div className="space-y-2">
            {distinctParticipants.map((p) => (
              <form
                key={p.rawIdentifier}
                action={saveMappingAction}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
              >
                <input type="hidden" name="rawIdentifier" value={p.rawIdentifier} />
                <span className="min-w-40 flex-1 font-mono text-xs">{p.rawIdentifier}</span>
                <ManagerSelect managers={managers} value={p.linkedManagerId} />
                <button type="submit" className="text-xs font-medium text-primary hover:underline">
                  Save
                </button>
              </form>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="font-heading mb-3 text-lg font-semibold tracking-wide uppercase">
          Remembered mappings
        </h2>
        {mappings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No remembered identity mappings yet. Linking a participant above stores one here and
            auto-applies it to every future import.
          </p>
        ) : (
          <div className="space-y-2">
            {mappings.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs">{m.rawIdentifier}</span>
                <Badge variant={m.managerName ? "outline" : "secondary"}>
                  {m.managerName ?? "(unlinked)"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ManagerSelect({
  managers,
  value,
}: {
  managers: ManagerOption[];
  value: string | null;
}) {
  return (
    <select
      name="managerId"
      defaultValue={value ?? ""}
      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
    >
      <option value="">(unlinked)</option>
      {managers.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}
        </option>
      ))}
    </select>
  );
}
