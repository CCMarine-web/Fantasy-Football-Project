import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { listPunishments } from "@/server/repositories/punishment-repository";
import { PunishmentForm } from "./punishment-form";
import { deletePunishmentAction } from "./actions";

export const metadata = { title: "Edit Punishments" };

export default async function AdminPunishmentsPage() {
  const [managers, punishments] = await Promise.all([
    prisma.manager.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    listPunishments(),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Last-Place Punishments"
        description="Record each season's punishment. Saving overwrites the entry for that year."
        actions={
          <Button render={<Link href="/hall-of-shame" />} nativeButton={false} variant="outline" size="sm">
            View Hall of Shame
          </Button>
        }
      />

      <div className="mt-8">
        <PunishmentForm managers={managers} />
      </div>

      <div className="mt-8 space-y-2">
        {punishments.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-md border border-border/60 bg-card/30 px-3 py-2 text-sm">
            <span>
              <Badge variant="outline" className="mr-2">
                {p.year}
              </Badge>
              {p.managerName ?? "—"}: {p.description}
            </span>
            <form action={deletePunishmentAction}>
              <input type="hidden" name="year" value={p.year} />
              <button type="submit" className="text-xs text-destructive hover:underline">
                Delete
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
