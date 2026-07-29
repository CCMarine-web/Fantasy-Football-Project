import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ManagerLink } from "@/components/shared/manager-link";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PunishmentGallery } from "@/components/shame/punishment-gallery";
import { MiscPunishmentGallery } from "@/components/shame/misc-punishment-gallery";
import { getHallOfShame } from "@/server/repositories/hall-of-shame-repository";
import {
  LAST_PLACE_FALLBACK_NOTE,
  LAST_PLACE_METHODOLOGY,
} from "@/server/stats/last-place";
import { ordinal } from "@/lib/format";
import { Camera, Skull } from "lucide-react";

export const metadata = { title: "Hall of Shame" };

/*
 * Fully server-rendered; nothing here is fetched from the browser.
 *
 * There is deliberately no `export const revalidate`: this page calls `auth()`
 * to decide whether to show the admin notice, which reads cookies and makes the
 * route dynamic, and a route-segment revalidate is inert on a dynamic route.
 * The expensive part is cached a layer down instead — see server/cache.ts.
 */

export default async function HallOfShamePage() {
  const [shame, session, pendingPunishmentPhotos] = await Promise.all([
    getHallOfShame(),
    auth(),
    prisma.mediaAsset.count({
      where: { category: "PUNISHMENT", approvalStatus: "PENDING" },
    }),
  ]);
  const isAdmin = session?.user?.role === "ADMIN";
  const benchCovered = shame.benchYearsCovered;
  const benchGap = shame.allYears.filter((y) => !benchCovered.includes(y));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="The Wall of Woe"
        title="Hall of Shame"
        description="The inverse of the record books — the lows, the blowouts, the last-place finishes, and the punishments that followed."
      />

      {/*
        ── 1. The photographs, unlabelled ─────────────────────────────────
        Leads the page because the photographs ARE the Hall of Shame; the tables
        below are the bookkeeping. Nothing here carries a year, a name or a
        caption: no record exists of which punishment any of these shows, and
        inventing one would put a real person's face against something they may
        not have done. See listUnlabelledPunishmentPhotos.
      */}
      {shame.gallery.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
              <Camera className="h-5 w-5" /> Punishment Gallery
            </h2>
            {isAdmin ? (
              <Link href="/admin/media" className="text-sm text-primary hover:underline">
                Manage photographs
              </Link>
            ) : null}
          </div>
          <MiscPunishmentGallery photos={shame.gallery} />
        </section>
      ) : null}

      {/*
        ── 2. Punishments that ARE on the record, with a season and a name ──
        Separate from the gallery above, and shown only when an admin has
        genuinely attached a photograph or recorded a punishment. This is where a
        caption is legitimate, because somebody established it.
      */}
      {shame.punishmentPhotos.length > 0 || shame.punishmentsWithoutPhotos.length > 0 ? (
        <section className="mt-12">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
              <Camera className="h-5 w-5" /> Punishments on the Record
            </h2>
            {isAdmin ? (
              <Link href="/admin/punishments" className="text-sm text-primary hover:underline">
                Edit punishments
              </Link>
            ) : null}
          </div>

          {shame.punishmentPhotos.length > 0 ? (
            <PunishmentGallery items={shame.punishmentPhotos} />
          ) : null}

          {shame.punishmentsWithoutPhotos.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {shame.punishmentsWithoutPhotos.map((p) => (
                <span
                  key={p.id}
                  className="rounded-md border border-border/60 bg-card/40 px-3 py-1.5 text-xs text-muted-foreground"
                >
                  <span className="font-medium text-foreground">{p.year}</span>
                  {p.managerName ? ` · ${p.managerName}` : ""}
                  {p.description ? ` — ${p.description}` : ""} (no photograph)
                </span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {isAdmin && pendingPunishmentPhotos > 0 ? (
        <p className="mt-6 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs">
          {pendingPunishmentPhotos} punishment photograph
          {pendingPunishmentPhotos === 1 ? " is" : "s are"} still awaiting review in{" "}
          <Link href="/admin/media" className="font-medium text-primary hover:underline">
            Review Media
          </Link>
          . Admins only. The gallery above shows approved photographs without captions; attaching a
          season and a manager moves one into &ldquo;Punishments on the Record&rdquo; instead.
        </p>
      ) : null}

      {/* ── 3. Regular-season last place, one uninterrupted table ────────── */}
      <section className="mt-12">
        <h2 className="mb-2 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
          <Skull className="h-5 w-5" /> Last Place by Season
        </h2>
        <p className="mb-3 max-w-3xl text-sm text-muted-foreground">
          {LAST_PLACE_METHODOLOGY}{" "}
          The league&apos;s own standings order decides it wherever the platform recorded one.
          {shame.usesFallbackTiebreak ? ` ${LAST_PLACE_FALLBACK_NOTE}` : ""}
        </p>

        {shame.lastPlace.length === 0 ? (
          <EmptyState title="No completed seasons yet" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-2 py-2 text-left sm:px-4">Season</th>
                  <th className="px-2 py-2 text-left sm:px-4">Last Place</th>
                  {/* Widest and least essential column — hidden below `sm` so
                      Record and PF stay on screen rather than clipped. */}
                  <th className="hidden px-2 py-2 text-left sm:table-cell sm:px-4">Team</th>
                  <th className="px-2 py-2 text-right sm:px-4">Record</th>
                  <th className="px-2 py-2 text-right sm:px-4">PF</th>
                  <th className="hidden px-2 py-2 text-right sm:px-4 md:table-cell">Finish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shame.lastPlace.map((t) => (
                  <tr key={t.year}>
                    <td className="px-2 py-2 font-medium sm:px-4">{t.year}</td>
                    <td className="px-2 py-2 sm:px-4">
                      <ManagerLink managerId={t.managerId}>{t.managerName}</ManagerLink>
                      {t.basis === "POINTS_FALLBACK" ? (
                        <Badge variant="secondary" className="ml-2 align-middle text-[10px]">
                          points tiebreak
                        </Badge>
                      ) : null}
                    </td>
                    <td className="hidden px-2 py-2 text-muted-foreground sm:table-cell sm:px-4">
                      {t.teamName}
                    </td>
                    <td className="px-2 py-2 text-right font-mono sm:px-4">{t.record}</td>
                    <td className="px-2 py-2 text-right font-mono text-muted-foreground sm:px-4">
                      {t.pointsFor.toFixed(0)}
                    </td>
                    <td className="hidden px-2 py-2 text-right text-muted-foreground sm:px-4 md:table-cell">
                      {ordinal(t.teamsInSeason)} of {t.teamsInSeason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 4. The record lows ───────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">
          Record Lows
        </h2>

        {shame.excludedScores > 0 ? (
          <p className="mb-4 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {shame.excludedScores} recorded score{shame.excludedScores === 1 ? " is" : "s are"} left
            out of these records — weeks where a team was abandoned rather than beaten, or where the
            platform never reported a score. They are kept on the season pages, but a 0.0 from a team
            that stopped setting a lineup is not the lowest score in league history.
          </p>
        ) : null}

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
    </div>
  );
}
