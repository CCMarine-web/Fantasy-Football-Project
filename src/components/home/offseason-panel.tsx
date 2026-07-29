import Link from "next/link";
import { CalendarClock, Crown, Trophy, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TeamAvatar } from "@/components/shared/team-avatar";
import type { SeasonPhaseInfo } from "@/server/repositories/season-phase";
import type { SeasonNarrative } from "@/server/repositories/season-narrative-repository";

/**
 * What the homepage's main column shows between seasons.
 *
 * The alternative it replaces was an empty "Week 1 Matchups" grid saying "No
 * matchups yet" — accurate and useless. In the offseason the interesting facts
 * are the ones about the season just finished and the draft coming up, so they
 * fill the space instead.
 */

export interface OffseasonSpotlight {
  managerId: string;
  managerName: string;
  teamName: string;
  photoUrl: string | null;
  /** One verified sentence about their last season. */
  line: string;
}

export interface OffseasonData {
  defendingChampionName: string | null;
  defendingChampionId: string | null;
  defendingChampionTeam: string | null;
  defendingChampionYear: number | null;
  /** Draft order, when one has been set. */
  draftOrder: { managerName: string; slot: number }[];
  spotlights: OffseasonSpotlight[];
}

export function OffseasonPanel({
  phase,
  narrative,
  data,
}: {
  phase: SeasonPhaseInfo | null;
  narrative: SeasonNarrative | null;
  data: OffseasonData | null;
}) {
  const afterDraft = phase?.phase === "POST_DRAFT";
  const recap = narrative && !narrative.isMock ? narrative.text.replace(/\s+/g, " ").trim() : null;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
            {afterDraft ? "Post-Draft Preseason" : "The Offseason"}
          </h2>
        </div>
        <Card>
          <CardContent className="space-y-3">
            <p className="text-sm text-foreground/90">
              {afterDraft ? (
                <>
                  The draft is done — {phase?.draftPickCount} picks are on the board. Nothing has been
                  played yet, so there is no table and no form; what there is, is ten rosters and
                  opinions about them.
                </>
              ) : (
                <>
                  No football yet. The rosters do not exist, so nothing on this site can tell you who
                  is any good this year — only who has been good before.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/power-rankings" className="text-sm text-primary hover:underline">
                {afterDraft ? "Preseason power rankings →" : "Manager baseline rankings →"}
              </Link>
              {afterDraft ? (
                <Link href="/draft-report-cards" className="text-sm text-primary hover:underline">
                  Draft report cards →
                </Link>
              ) : null}
              <Link href="/history" className="text-sm text-primary hover:underline">
                Season history →
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/*
       * Last season's story — NOT another champion announcement.
       *
       * The Championship Belt sits directly above this on the homepage with the
       * champion's name, record, title run and reign counter. Repeating "X holds
       * the belt" here made the page say the same thing twice within one screen,
       * so this now leads on what the season was about and links to the full
       * retrospective.
       */}
      {recap && data?.defendingChampionYear ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Crown className="h-4 w-4 text-gold" />
            <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
              How {data.defendingChampionYear} Went
            </h2>
          </div>
          <Card className="border-gold/30">
            <CardContent className="space-y-2">
              <p className="text-sm leading-relaxed text-foreground/90">
                {recap.slice(0, 400)}
                {recap.length > 400 ? "…" : ""}
              </p>
              <Link
                href={`/history/${data.defendingChampionYear}`}
                className="inline-block text-sm text-primary hover:underline"
              >
                Read the {data.defendingChampionYear} season →
              </Link>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {data && data.draftOrder.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">Draft Order</h2>
          </div>
          <Card>
            <CardContent className="flex flex-wrap gap-2">
              {data.draftOrder.map((slot) => (
                <Badge key={slot.slot} variant="outline" className="font-mono">
                  {slot.slot}. {slot.managerName}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {data && data.spotlights.length > 0 ? (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="font-heading text-lg font-semibold tracking-wide uppercase">
              Manager Spotlights
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.spotlights.map((s) => (
              <Card key={s.managerId}>
                <CardContent className="flex items-start gap-3">
                  <TeamAvatar name={s.managerName} imageUrl={s.photoUrl} className="h-10 w-10 shrink-0" />
                  <div className="min-w-0">
                    <Link
                      href={`/managers/${s.managerId}`}
                      className="font-heading text-sm font-semibold hover:text-primary"
                    >
                      {s.managerName}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{s.teamName}</p>
                    <p className="mt-1 text-sm text-foreground/90">{s.line}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
