import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getHallOfShame } from "@/server/repositories/hall-of-shame-repository";
import { listPunishments } from "@/server/repositories/punishment-repository";
import { Skull, Toilet } from "lucide-react";

export const metadata = { title: "Hall of Shame" };

export default async function HallOfShamePage() {
  const [shame, punishments] = await Promise.all([getHallOfShame(), listPunishments()]);
  const benchCovered = shame.benchYearsCovered;
  const benchGap = shame.allYears.filter((y) => !benchCovered.includes(y));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Wall of Woe"
        title="Hall of Shame"
        description="The inverse of the record books — the lows, the blowouts, the toilet bowls, and the punishments that followed."
      />

      <section className="mt-8">
        {shame.entries.length === 0 ? (
          <EmptyState icon={Skull} title="Nothing shameful on record yet" />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shame.entries.map((e) => (
              <Card key={e.key}>
                <CardContent>
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">{e.label}</p>
                  <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{e.value}</p>
                  <p className="mt-1 text-sm font-medium">
                    {e.holderManagerId ? (
                      <Link href={`/managers/${e.holderManagerId}`} className="hover:text-primary">
                        {e.holderName}
                      </Link>
                    ) : (
                      e.holderName
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{e.detail}</p>
                  {e.key === "bench" && benchGap.length > 0 ? (
                    <p className="mt-2 text-[11px] text-muted-foreground/80">
                      Player-level data available for {benchCovered.join(", ")}; not for{" "}
                      {benchGap.join(", ")}.
                    </p>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Toilet Bowl history */}
      <section className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
          <Toilet className="h-5 w-5" /> Toilet Bowl — Last Place by Season
        </h2>
        {shame.toiletBowl.length === 0 ? (
          <EmptyState title="No completed seasons yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">Season</th>
                  <th className="px-4 py-2 text-left">Last Place</th>
                  <th className="px-4 py-2 text-left">Team</th>
                  <th className="px-4 py-2 text-right">Record</th>
                  <th className="px-4 py-2 text-right">PF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shame.toiletBowl.map((t) => (
                  <tr key={t.year}>
                    <td className="px-4 py-2 font-medium">{t.year}</td>
                    <td className="px-4 py-2">
                      <Link href={`/managers/${t.managerId}`} className="hover:text-primary">
                        {t.managerName}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{t.teamName}</td>
                    <td className="px-4 py-2 text-right font-mono">{t.record}</td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">{t.pointsFor.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Punishments */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
            Last-Place Punishments
          </h2>
          <Link href="/admin/punishments" className="text-sm text-primary hover:underline">
            Edit
          </Link>
        </div>
        {punishments.length === 0 ? (
          <EmptyState
            icon={Skull}
            title="No punishments recorded yet"
            description="Admins can record each year's last-place punishment (with a photo) from the admin tools."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {punishments.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex gap-4">
                  {p.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.photoUrl} alt={`${p.year} punishment`} className="h-20 w-20 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Skull className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{p.year}</Badge>
                      {p.managerName ? (
                        <Link href={`/managers/${p.managerId}`} className="text-sm font-semibold hover:text-primary">
                          {p.managerName}
                        </Link>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-foreground/90">{p.description}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
