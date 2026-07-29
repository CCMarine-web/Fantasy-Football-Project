import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { listPunishments } from "@/server/repositories/punishment-repository";
import { getLastPlaceBySeason } from "@/server/repositories/hall-of-shame-repository";
import { PunishmentForm } from "./punishment-form";
import { deletePunishmentAction } from "./actions";

export const metadata = { title: "Edit Punishments" };

export default async function AdminPunishmentsPage() {
  const [managers, punishments, photoAssets, lastPlace] = await Promise.all([
    prisma.manager.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    listPunishments(),
    prisma.mediaAsset.findMany({
      where: { category: "PUNISHMENT" },
      select: { id: true, url: true, originalFilename: true },
      orderBy: { originalFilename: "asc" },
    }),
    getLastPlaceBySeason(),
  ]);

  const recordedYears = new Set(punishments.map((p) => p.year));
  const yearByUrl = new Map(punishments.filter((p) => p.photoUrl).map((p) => [p.photoUrl!, p.year]));
  const photos = photoAssets.map((a) => ({
    id: a.id,
    url: a.url,
    originalFilename: a.originalFilename,
    attachedToYear: yearByUrl.get(a.url) ?? null,
  }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Last-Place Punishments"
        description="Record each season's punishment and attach its photograph. Last place is the bottom of the regular-season standings, not the consolation bracket. Saving overwrites the entry for that year."
        actions={
          <Button render={<Link href="/hall-of-shame" />} nativeButton={false} variant="outline" size="sm">
            View Hall of Shame
          </Button>
        }
      />

      <div className="mt-8">
        <PunishmentForm managers={managers} photos={photos} />
      </div>

      {/* Who actually finished last, so the year and the manager cannot be
          filled in from memory and get it wrong. */}
      <div className="mt-8">
        <h2 className="mb-2 font-heading text-sm font-semibold tracking-wide uppercase">
          Regular-season last place, by season
        </h2>
        <div className="overflow-hidden rounded-md border border-border/60">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border/60">
              {lastPlace.map((l) => (
                <tr key={l.year} className={recordedYears.has(l.year) ? "opacity-60" : undefined}>
                  <td className="px-3 py-1.5 font-mono">{l.year}</td>
                  <td className="px-3 py-1.5 font-medium">{l.managerName}</td>
                  <td className="px-3 py-1.5 font-mono text-muted-foreground">{l.record}</td>
                  <td className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                    {recordedYears.has(l.year) ? "punishment recorded" : "not recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
