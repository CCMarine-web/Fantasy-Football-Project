import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/auth";
import {
  listManagerIdentityOverview,
  type ManagerIdentityView,
} from "@/server/repositories/admin-review-repository";

export const metadata = { title: "Manager Mappings" };

export const dynamic = "force-dynamic";

export default async function AdminManagerMappingsPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    throw new Error("Admins only");
  }

  const managers = await listManagerIdentityOverview();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Manager Mappings"
        description="Identity overview: every manager's aliases, photo, and remembered chat identifiers (phones/handles)."
      />

      <section className="mt-8">
        {managers.length === 0 ? (
          <EmptyState title="No managers on record" />
        ) : (
          <div className="space-y-3">
            {managers.map((m) => (
              <ManagerRow key={m.id} manager={m} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ManagerRow({ manager }: { manager: ManagerIdentityView }) {
  // Group aliases by aliasType.
  const byType = new Map<string, string[]>();
  for (const a of manager.aliases) {
    const list = byType.get(a.aliasType) ?? [];
    list.push(a.value);
    byType.set(a.aliasType, list);
  }
  const groups = [...byType.entries()];

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4 text-sm sm:flex-row">
        <div className="shrink-0">
          {manager.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={manager.photoUrl}
              alt={manager.displayName}
              className="h-16 w-16 rounded-full bg-muted object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
              no photo
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-heading text-base font-semibold">{manager.displayName}</p>

          {groups.length === 0 ? (
            <p className="text-xs text-muted-foreground">No aliases recorded.</p>
          ) : (
            <div className="space-y-1">
              {groups.map(([type, values]) => (
                <div key={type} className="flex flex-wrap items-center gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{type}:</span>
                  {values.map((v) => (
                    <Badge key={`${type}-${v}`} variant="outline" className="text-[10px]">
                      {v}
                    </Badge>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs font-medium text-muted-foreground">Chat identifiers:</span>
            {manager.identityRawIdentifiers.length === 0 ? (
              <span className="text-xs text-muted-foreground">none</span>
            ) : (
              manager.identityRawIdentifiers.map((raw) => (
                <Badge key={raw} variant="secondary" className="font-mono text-[10px]">
                  {raw}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
