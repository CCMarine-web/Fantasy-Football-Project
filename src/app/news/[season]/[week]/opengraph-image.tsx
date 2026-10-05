import { prisma } from "@/lib/db";
import { getArticleBySeasonWeek } from "@/server/repositories/news-repository";
import { getWeeklyAwards, type WeeklyAwardView } from "@/server/repositories/weekly-awards-repository";
import { BRAND } from "@/lib/branding";
import {
  brandCardResponse,
  fitFontSize,
  HEADING_FONT,
  Label,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  ogResponse,
  Panel,
} from "@/lib/og/frame";

/*
 * This page sets its own `openGraph` (title and description, no images), and
 * Next replaces an inherited openGraph block wholesale — so without a card of
 * its own a weekly recap unfurled with no image at all, not even the default.
 */
export const alt = `Weekly recap — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

function Award({ award }: { award: WeeklyAwardView }) {
  return (
    <Panel style={{ flex: 1, padding: "16px 22px" }}>
      <Label size={18} color={OG_COLORS.accent}>
        {award.label}
      </Label>
      <div
        style={{
          display: "block",
          lineClamp: 1,
          marginTop: 2,
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: 36,
          lineHeight: 1.15,
          textTransform: "uppercase",
          color: OG_COLORS.text,
        }}
      >
        {award.managerName}
      </div>
    </Panel>
  );
}

export default async function Image({ params }: { params: Promise<{ season: string; week: string }> }) {
  let issue: { year: number; week: number; title: string; awards: WeeklyAwardView[] } | null = null;
  try {
    const { season, week } = await params;
    const year = Number(season);
    const wk = Number(week);
    if (Number.isInteger(year) && Number.isInteger(wk)) {
      /*
       * The page's loader (getWeeklyRecap) also fetches every game's AI recap;
       * the card needs only what it shows. Same existence rule as the page: a
       * week with no matchups is not an issue.
       */
      const s = await prisma.season.findFirst({ where: { year }, select: { id: true } });
      const games = s ? await prisma.matchup.count({ where: { seasonId: s.id, week: wk } }) : 0;
      if (s && games > 0) {
        const [awards, article] = await Promise.all([getWeeklyAwards(s.id, wk), getArticleBySeasonWeek(year, wk)]);
        issue = { year, week: wk, title: article?.title ?? `Week ${wk} Recap`, awards };
      }
    }
  } catch (err) {
    console.error("[og] weekly recap card:", err);
  }
  if (!issue) return brandCardResponse();

  const awards = issue.awards.slice(0, 3);
  return ogResponse(
    <OgFrame
      eyebrow={`Week ${issue.week} · ${issue.year}`}
      title={issue.title}
      titleSize={fitFontSize(issue.title, { width: 1072, max: 84, min: 52, lines: 2 })}
      subtitle={awards.length === 0 ? "The awards, the results and the recap." : undefined}
    >
      {awards.length > 0 ? (
        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", gap: 16 }}>
          {awards.map((a) => (
            <Award key={a.type} award={a} />
          ))}
        </div>
      ) : null}
    </OgFrame>,
  );
}
