import Image from "next/image";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ManagerLink } from "@/components/shared/manager-link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getHallOfShame } from "@/server/repositories/hall-of-shame-repository";
import { listPunishments } from "@/server/repositories/punishment-repository";
import { Skull, Toilet } from "lucide-react";

export const metadata = { title: "Hall of Shame" };

export default async function HallOfShamePage() {
  const [shame, punishments, session, pendingPunishmentPhotos] = await Promise.all([
    getHallOfShame(),
    listPunishments(),
    auth(),
    prisma.mediaAsset.count({ where: { category: "PUNISHMENT", approvalStatus: "PENDING" } }),
  ]);
  const isAdmin = session?.user?.role === "ADMIN";
  const benchCovered = shame.benchYearsCovered;
  const benchGap = shame.allYears.filter((y) => !benchCovered.includes(y));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Wall of Woe"
        title="Hall of Shame"
        description="The inverse of the record books — the lows, the blowouts, the toilet bowls, and the punishments that followed."
      />

      {shame.excludedScores > 0 ? (
        <p className="mt-6 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {shame.excludedScores} recorded score{shame.excludedScores === 1 ? " is" : "s are"} left out
          of these records — weeks where a team was abandoned rather than beaten, or where the
          platform never reported a score. They are kept on the season pages but a 0.0 from a team
          that stopped setting a lineup is not the lowest score in league history.
        </p>
      ) : null}

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
                      <ManagerLink managerId={e.holderManagerId}>{e.holderName}</ManagerLink>
                    ) : (
                      e.holderName
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{e.detail}</p>
                  {e.key === "bench" && benchGap.length > 0 ? (
                    <p className="mt-2 text-[13px] text-muted-foreground/80">
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
                  <th className="px-2 sm:px-4 py-2 text-left">Season</th>
                  <th className="px-2 py-2 sm:px-4 text-left">Last Place</th>
                  {/* Widest and least essential column — hidden below `sm` so
                      Record and PF stay on screen rather than clipped. */}
                  <th className="hidden px-2 py-2 sm:px-4 text-left sm:table-cell">Team</th>
                  <th className="px-2 py-2 sm:px-4 text-right">Record</th>
                  <th className="px-2 py-2 sm:px-4 text-right">PF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shame.toiletBowl.map((t) => (
                  <tr key={t.year}>
                    <td className="px-2 py-2 sm:px-4 font-medium">{t.year}</td>
                    <td className="px-2 py-2 sm:px-4">
                      <ManagerLink managerId={t.managerId}>{t.managerName}</ManagerLink>
                    </td>
                    <td className="hidden px-2 py-2 sm:px-4 text-muted-foreground sm:table-cell">{t.teamName}</td>
                    <td className="px-2 py-2 sm:px-4 text-right font-mono">{t.record}</td>
                    <td className="px-2 py-2 sm:px-4 text-right font-mono text-muted-foreground">{t.pointsFor.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/*
       * Punishments. The "Edit" link used to be rendered for everybody, which
       * pointed the public at an admin route they could not open; it is now
       * admin-only. Photographs lead the card rather than sitting in a 80px
       * thumbnail, because the photograph IS the punishment record.
       */}
      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
            Last-Place Punishments
          </h2>
          {isAdmin ? (
            <Link href="/admin/punishments" className="text-sm text-primary hover:underline">
              Edit
            </Link>
          ) : null}
        </div>

        {isAdmin && pendingPunishmentPhotos > 0 ? (
          <p className="mb-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
            {pendingPunishmentPhotos} punishment photograph
            {pendingPunishmentPhotos === 1 ? "" : "s"} imported but not yet attached to a season.
            Their filenames name no year or manager, so they were not guessed at —{" "}
            <Link href="/admin/media" className="font-medium text-primary hover:underline">
              assign them in Review Media
            </Link>
            . Admins only; nothing is public until attached.
          </p>
        ) : null}

        {punishments.length === 0 ? (
          <EmptyState
            icon={Skull}
            title="No punishments recorded yet"
            description="Each season's last-place punishment appears here once it has been recorded with a year, a manager, and a photograph."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {punishments.map((p) => (
              <Card key={p.id} className="overflow-hidden pt-0">
                {p.photoUrl ? (
                  <Image
                    src={p.photoUrl}
                    alt={`${p.managerName ? `${p.managerName}'s ` : ""}${p.year} last-place punishment: ${p.description}`}
                    width={1400}
                    height={1050}
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="max-h-96 w-full bg-muted object-contain"
                  />
                ) : null}
                <CardContent className="flex gap-4">
                  {p.photoUrl ? null : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Skull className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{p.year}</Badge>
                      {/* A punishment can name a manager who has no linked row
                          (hand-entered history), so the link is only rendered
                          when there is an id to link to — previously this built
                          an href of "/managers/null". */}
                      {p.managerName && p.managerId ? (
                        <ManagerLink managerId={p.managerId} className="text-sm font-semibold">
                          {p.managerName}
                        </ManagerLink>
                      ) : p.managerName ? (
                        <span className="text-sm font-semibold">{p.managerName}</span>
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
