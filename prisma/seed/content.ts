import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ManagerKey } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

export interface ContentSeedInput {
  prisma: PrismaClient;
  managerIdByKey: Record<ManagerKey, string>;
  seasonIdByYear: Record<number, string>;
}

export async function seedContent(input: ContentSeedInput): Promise<void> {
  const { prisma, managerIdByKey, seasonIdByYear } = input;
  const m = managerIdByKey;

  // --- Articles ------------------------------------------------------------
  const articles: {
    seasonId: string;
    week: number | null;
    type: Prisma.ArticleCreateManyInput["type"];
    title: string;
    slug: string;
    sections: { order: number; sectionType: Prisma.ArticleSectionCreateManyInput["sectionType"]; heading?: string; body: string; relatedManagerId?: string }[];
  }[] = [
    {
      seasonId: seasonIdByYear[2024]!,
      week: 5,
      type: "WEEKLY_ISSUE",
      title: "Week 5: The Casket Company Opens for Business",
      slug: "week-5-casket-company",
      sections: [
        {
          order: 1,
          sectionType: "INTRO",
          body: "Five weeks into the 2024 campaign and the league has already sorted itself into contenders, pretenders, and Kevin O'Malley. This week's slate delivered exactly one competitive game and several acts of fantasy malpractice.",
        },
        {
          order: 2,
          sectionType: "MATCHUP_RECAP",
          heading: "Cole's Casket Company buries Whitfield's Wildcats",
          body: "Marcus Cole's RB-heavy build finally clicked, piling up 152.4 points behind three separate 20-burst performances. Jordan Whitfield's Wildcats managed 98.1, most of it garbage time. Marcus was seen in the group chat measuring Jordan for a coffin emoji within minutes of the final whistle.",
          relatedManagerId: m.marcus,
        },
        {
          order: 3,
          sectionType: "MANAGER_OF_WEEK",
          heading: "Manager of the Week: Sofia Reyes",
          body: "Sofia Reyes didn't just win — she won while benching her WR1 for a Thursday-night gamble that paid off to the tune of 19 extra points. Dynasty behavior.",
          relatedManagerId: m.sofia,
        },
        {
          order: 4,
          sectionType: "WORST_DECISION",
          heading: "Worst Decision of the Week: Kevin O'Malley",
          body: "Kevin started his kicker over a player who scored 24 points on the bench. When asked why, Kevin said, 'I trust the process.' There is no process. There has never been a process.",
          relatedManagerId: m.kevin,
        },
        {
          order: 5,
          sectionType: "QUOTE_OF_WEEK",
          heading: "Quote of the Week",
          body: "\"I didn't lose, I donated.\" — Kevin O'Malley, immediately after donating.",
          relatedManagerId: m.kevin,
        },
        {
          order: 6,
          sectionType: "PREVIEW",
          heading: "Next Week",
          body: "Week 6 brings the first Sofia-Marcus clash of the season. Book your popcorn accordingly.",
        },
      ],
    },
    {
      seasonId: seasonIdByYear[2024]!,
      week: 6,
      type: "MATCHUP_RECAP",
      title: "Week 6: Reyes of Sunshine Survive a Marcus Cole Onslaught",
      slug: "week-6-sofia-marcus",
      sections: [
        {
          order: 1,
          sectionType: "MATCHUP_RECAP",
          body: "In the marquee matchup of the year so far, Sofia Reyes edged Marcus Cole 118.6 to 114.9 in a game that came down to Monday Night Football. Marcus's tight end needed 8 points to win it. He got 6.",
          relatedManagerId: m.sofia,
        },
      ],
    },
    {
      seasonId: seasonIdByYear[2023]!,
      week: null,
      type: "SEASON_SUMMARY",
      title: "2023 Season in Review: The Dynasty Repeats",
      slug: "2023-season-summary",
      sections: [
        {
          order: 1,
          sectionType: "GENERIC",
          heading: "A Second Ring for Reyes of Sunshine",
          body: "Sofia Reyes closed out 2023 exactly the way she opened it: on top. The back-to-back title cements her as the league's first true dynasty, and the group chat's collective blood pressure as a permanent public health concern.",
          relatedManagerId: m.sofia,
        },
        {
          order: 2,
          sectionType: "GENERIC",
          heading: "The Alley Cats, Predictably",
          body: "Kevin O'Malley finished outside the playoff picture for the third straight year, and for the third straight year insisted this was 'the year everything breaks right.' It did not break right.",
          relatedManagerId: m.kevin,
        },
      ],
    },
  ];

  for (const article of articles) {
    const articleId = newId();
    await prisma.article.create({
      data: {
        id: articleId,
        seasonId: article.seasonId,
        week: article.week,
        type: article.type,
        title: article.title,
        slug: article.slug,
        status: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    await prisma.articleSection.createMany({
      data: article.sections.map((s) => ({
        id: newId(),
        articleId,
        order: s.order,
        sectionType: s.sectionType,
        heading: s.heading ?? null,
        body: s.body,
        relatedManagerId: s.relatedManagerId ?? null,
      })),
    });
  }

  // --- Historical quotes -----------------------------------------------------
  const quotes: { text: string; managerId: string; context: string; featured: boolean }[] = [
    { text: "I didn't lose, I donated.", managerId: m.kevin!, context: "After a Week 5 loss, 2024", featured: true },
    { text: "Bury your kicker, Kevin.", managerId: m.marcus!, context: "Trash talk before a matchup, 2024", featured: true },
    { text: "It's not a rebuild if it never ends.", managerId: m.jordan!, context: "On Kevin's roster strategy", featured: false },
    { text: "The spreadsheet doesn't lie. You lie. The spreadsheet just reports it.", managerId: m.priya!, context: "League group chat, 2022", featured: true },
    { text: "I would like to formally apologize to no one.", managerId: m.sofia!, context: "After winning her second title", featured: true },
    { text: "This is a transition year.", managerId: m.kevin!, context: "Every single year since 2021", featured: false },
    { text: "Analytics is a whole mood, not a strategy.", managerId: m.emily!, context: "Defending her draft board", featured: false },
    { text: "I traded my 2025 first for a kicker and I'd do it again.", managerId: m.devon!, context: "Trade deadline, 2023", featured: false },
    { text: "Somebody stop Sofia. Anybody. Please.", managerId: m.brianna!, context: "League group chat, 2023", featured: true },
    { text: "The bench outscoring the starters isn't bad luck, it's a bench problem.", managerId: m.natalie!, context: "Roasting Kevin's lineup", featured: false },
  ];
  await prisma.historicalQuote.createMany({
    data: quotes.map((q) => ({
      id: newId(),
      text: q.text,
      managerId: q.managerId,
      context: q.context,
      isFeatured: q.featured,
      approvalStatus: "APPROVED",
    })),
  });

  // --- Awards ----------------------------------------------------------------
  const awardRows: Prisma.AwardCreateManyInput[] = [];
  const championsByYear: Record<number, ManagerKey> = { 2021: "sofia", 2022: "marcus", 2023: "sofia", 2024: "deshawn" };
  for (const [yearStr, key] of Object.entries(championsByYear)) {
    const year = Number(yearStr);
    awardRows.push({
      id: newId(),
      seasonId: seasonIdByYear[year]!,
      type: "CHAMPION",
      managerId: m[key]!,
      description: `Won the ${year} league championship.`,
    });
  }
  awardRows.push(
    { id: newId(), seasonId: seasonIdByYear[2024]!, week: 5, type: "MANAGER_OF_WEEK", managerId: m.sofia!, description: "Bench gamble paid off big in Week 5." },
    { id: newId(), seasonId: seasonIdByYear[2024]!, week: 5, type: "WORST_DECISION_OF_WEEK", managerId: m.kevin!, description: "Started a kicker over 24 bench points." },
    { id: newId(), seasonId: seasonIdByYear[2024]!, week: 3, type: "BAD_BEAT", managerId: m.jordan!, description: "Lost by 0.4 points on a Monday-night field goal." },
    { id: newId(), seasonId: seasonIdByYear[2024]!, week: 2, type: "FRAUD_WIN", managerId: m.devon!, description: "Won by 40 despite a below-average scoring week — the schedule was just that soft." },
    { id: newId(), seasonId: seasonIdByYear[2023]!, type: "BEST_WAIVER_PICKUP", managerId: m.brianna!, description: "Turned a $4 FAAB bid into a playoff-run difference-maker." },
    { id: newId(), seasonId: seasonIdByYear[2022]!, type: "BIGGEST_TRADE", managerId: m.deshawn!, description: "Fleeced a division rival at the deadline en route to a deep playoff run." },
  );
  await prisma.award.createMany({ data: awardRows });
}
