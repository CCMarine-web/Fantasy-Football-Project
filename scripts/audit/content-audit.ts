import "../lib/load-env";
import { prisma } from "@/lib/db";
import { cardSummary } from "@/server/repositories/manager-repository";

/**
 * Reads every piece of SAVED editorial copy the public site renders and reports
 * the things a reader would notice.
 *
 *   npx tsx scripts/audit/content-audit.ts
 *
 * ── Why a content audit and not a code audit ───────────────────────────────
 * The prompts were fixed weeks before the copy was. A page can be built from a
 * corrected prompt and still print the sentence the old prompt produced, because
 * what it renders is a row in the database, not the prompt. Every defect below
 * was reported on the live site while the code that generates it was already
 * correct.
 *
 * What it looks for:
 *  - references to how the personality material was obtained (the group chat,
 *    text messages, memes, "chatter", archives, AI extraction). These are true
 *    and are exactly what should never appear in a published profile.
 *  - typos and malformed phrasings that have been seen in production
 *  - copy discussing a factor the ranking did not measure
 *  - bios that are too short to be a profile, or card summaries that overrun
 */

/**
 * Phrases that betray where the personality material came from.
 *
 * "archive" is deliberately absent: the honest sentence "ESPN does not retain
 * transactions for archived seasons" is a statement about a fantasy platform,
 * appears in five season articles, and is exactly the kind of limitation the
 * site should keep saying out loud. Only the chat-shaped senses are flagged.
 */
const SOURCE_LEAKS: { label: string; pattern: RegExp }[] = [
  {
    label: "group chat",
    pattern: /\bgroup[ -]?chat|\bthe chat\b|\bin chat\b|\boff chat\b|\bchat (log|persona|archive)/i,
  },
  { label: "text messages", pattern: /\btext(s\b|ing\b| message)/i },
  { label: "memes", pattern: /\bmemes?\b|\bmeme-(forward|heavy)\b/i },
  { label: "chatter", pattern: /\bchatter\b/i },
  { label: "conversation archive", pattern: /\b(conversation|message) (archive|history)\b/i },
  {
    label: "AI / extraction",
    pattern:
      /\b(the|our|this) (model|algorithm)\b|\bAI-(generated|written|extracted)\b|\bpersonality (profile|extraction)\b|\bLLM\b/i,
  },
  { label: "thread / DM", pattern: /\bthe thread\b|\bDMs\b|\bgroupme\b|\bimessage\b|\bwhatsapp\b/i },
];

/**
 * Wordings that have shipped and read as broken.
 *
 * The whitespace check looks for a run of spaces WITHIN a line. It used to be
 * /\s{2,}\S/, which matches the blank line between two paragraphs and therefore
 * flagged every well-formed multi-paragraph bio on the site.
 */
const TYPOS: { label: string; pattern: RegExp }[] = [
  { label: '"closet game" (should be "closest")', pattern: /closet\s+(game|margin|win|loss|call)/i },
  { label: "unrendered field name", pattern: /\b[a-z]+[A-Z][a-zA-Z]*\s*[:=]/ },
  { label: "concatenated team name and year", pattern: /[a-zA-Z?!]\d{4}\b/ },
  { label: "doubled ordinal suffix", pattern: /\b\d+(?:st|nd|rd|th)\s*(?:st|nd|rd|th)\b/i },
  {
    label: "malformed ordinal",
    pattern: /\b\d*(?:[04-9]|1[1-3])(?:st|nd|rd)\b|\b\d*1th\b|\b\d*2(?:st|rd)\b|\b\d*3(?:st|nd)\b/,
  },
  { label: "run of spaces inside a line", pattern: /[^\S\n]{2,}\S/ },
  // A period followed by a digit is a leading-decimal average (".547 all-play"),
  // which is how these are written and read. Only real stray punctuation counts.
  { label: "space before punctuation", pattern: /[^\S\n]+(?:[,;]|\.(?!\d))/ },
  { label: "placeholder", pattern: /\b(TODO|TBD|lorem ipsum|undefined|NaN)\b/ },
];

/**
 * Factors the rankings did not measure, and must therefore not be characterised.
 *
 * "draft" on its own is not a defect: "before the draft, he sits third" is the
 * honest framing the pre-draft mode requires. What is a defect is passing
 * judgement on a draft or a keeper haul as though it had been weighed.
 */
const PHANTOM_FACTORS: { label: string; pattern: RegExp }[] = [
  { label: "keeper talk", pattern: /\bkeepers?\b|\bkeeper value\b|\bcarry-?overs?\b/i },
  {
    label: "judging a draft that was not an input",
    pattern:
      /\b(strong|weak|excellent|poor|smart|shrewd|questionable|impressive)\s+(draft|draft class|draft haul)\b|\bdraft (capital|board|haul|class)\b|\bdrafted well\b/i,
  },
  { label: "roster strength", pattern: /\broster (strength|construction|build)\b/i },
];

interface Finding {
  where: string;
  subject: string;
  problem: string;
  excerpt: string;
}

const findings: Finding[] = [];

function scan(
  where: string,
  subject: string,
  text: string | null | undefined,
  checks: { label: string; pattern: RegExp }[],
) {
  if (!text) return;
  for (const check of checks) {
    const match = check.pattern.exec(text);
    if (!match) continue;
    const at = match.index ?? 0;
    findings.push({
      where,
      subject,
      problem: check.label,
      excerpt: text.slice(Math.max(0, at - 60), at + 90).replace(/\s+/g, " ").trim(),
    });
  }
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function main() {
  console.log("=== saved-content audit ===\n");

  // --- manager bios and card summaries -------------------------------------
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    orderBy: { displayName: "asc" },
    select: {
      displayName: true,
      bio: true,
      nickname: true,
      nicknameOrigin: true,
      signatureMove: true,
      performanceSummary: { select: { summary: true, isMock: true } },
      commProfile: { select: { styleSummary: true, isMock: true } },
    },
  });

  console.log(`managers: ${managers.length}`);
  for (const m of managers) {
    const bio = m.performanceSummary?.summary ?? null;
    scan("manager bio", m.displayName, bio, [...SOURCE_LEAKS, ...TYPOS]);
    scan("manager.bio column", m.displayName, m.bio, [...SOURCE_LEAKS, ...TYPOS]);
    scan("nickname origin", m.displayName, m.nicknameOrigin, SOURCE_LEAKS);
    scan("signature move", m.displayName, m.signatureMove, SOURCE_LEAKS);

    if (!bio) {
      findings.push({
        where: "manager bio",
        subject: m.displayName,
        problem: "no saved bio at all",
        excerpt: "—",
      });
    } else {
      const n = words(bio);
      if (n < 220) {
        findings.push({
          where: "manager bio",
          subject: m.displayName,
          problem: `bio is only ${n} words — too short to cover a nine-season career`,
          excerpt: bio.slice(0, 120),
        });
      }
      const paragraphs = bio.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
      if (paragraphs < 3) {
        findings.push({
          where: "manager bio",
          subject: m.displayName,
          problem: `bio is ${paragraphs} paragraph(s) — asked for several`,
          excerpt: bio.slice(0, 120),
        });
      }
    }
    /*
     * The Managers-page card. Derived from the bio rather than generated, so
     * this checks the derivation lands in the band a reader was promised — 120
     * to 180 words. A card outside it means the opening paragraph of that bio is
     * either too thin to stand alone or too long to be a card.
     */
    const card = cardSummary(bio);
    if (bio && !card) {
      findings.push({
        where: "manager card",
        subject: m.displayName,
        problem: "bio exists but no card summary could be derived from it",
        excerpt: bio.slice(0, 120),
      });
    } else if (card) {
      const n = words(card);
      if (n < 120 || n > 180) {
        findings.push({
          where: "manager card",
          subject: m.displayName,
          problem: `card summary is ${n} words, outside the 120-180 band`,
          excerpt: card.slice(0, 120),
        });
      }
    }

    if (m.performanceSummary?.isMock) {
      findings.push({
        where: "manager bio",
        subject: m.displayName,
        problem: "bio is mock placeholder copy",
        excerpt: (bio ?? "").slice(0, 120),
      });
    }
  }

  // --- power-ranking blurbs -------------------------------------------------
  const powerBlurbs = await prisma.aIBlurbCache.findMany({
    where: { kind: "POWER_RANKING" },
    select: { subjectKey: true, text: true, updatedAt: true },
  });
  console.log(`power-ranking blurbs: ${powerBlurbs.length}`);
  for (const b of powerBlurbs) {
    scan("power blurb", b.subjectKey, b.text, [...TYPOS, ...PHANTOM_FACTORS]);
  }

  // --- rivalry summaries ----------------------------------------------------
  const rivalries = await prisma.rivalry.findMany({
    where: { summary: { not: null } },
    select: {
      isOfficial: true,
      summary: true,
      managerA: { select: { displayName: true } },
      managerB: { select: { displayName: true } },
    },
  });
  console.log(`rivalry summaries: ${rivalries.length}`);
  for (const r of rivalries) {
    const label = `${r.managerA.displayName} v ${r.managerB.displayName}${r.isOfficial ? " (official)" : ""}`;
    scan("rivalry summary", label, r.summary, [...SOURCE_LEAKS, ...TYPOS]);
  }

  // --- draft-grade rationales ----------------------------------------------
  const grades = await prisma.draftGrade.findMany({
    where: { OR: [{ rationale: { not: null } }, { revisitedRationale: { not: null } }] },
    select: {
      rationale: true,
      revisitedRationale: true,
      manager: { select: { displayName: true } },
      season: { select: { year: true } },
    },
  });
  console.log(`draft grades with prose: ${grades.length}`);
  for (const g of grades) {
    const label = `${g.manager.displayName} ${g.season.year}`;
    scan("draft grade (original)", label, g.rationale, [...SOURCE_LEAKS, ...TYPOS]);
    scan("draft grade (revisited)", label, g.revisitedRationale, [...SOURCE_LEAKS, ...TYPOS]);
    // Hindsight belongs only in the revisited grade.
    scan("draft grade (original)", label, g.rationale, [
      {
        label: "hindsight in the ORIGINAL grade",
        pattern:
          /\b(turned out|in hindsight|ended up|would (go on to|finish)|as it happened|proved to be|finished the season|went on to)\b/i,
      },
    ]);
  }

  // --- trade verdicts -------------------------------------------------------
  const tradeBlurbs = await prisma.aIBlurbCache.findMany({
    where: { kind: "TRADE_VERDICT" },
    select: { subjectKey: true, text: true },
  });
  console.log(`trade verdicts: ${tradeBlurbs.length}`);
  for (const b of tradeBlurbs) scan("trade verdict", b.subjectKey, b.text, [...SOURCE_LEAKS, ...TYPOS]);

  // --- season articles ------------------------------------------------------
  const sections = await prisma.articleSection.findMany({
    select: {
      heading: true,
      body: true,
      article: { select: { title: true, season: { select: { year: true } } } },
    },
  });
  console.log(`article sections: ${sections.length}`);
  for (const s of sections) {
    scan(
      "article section",
      `${s.article.season?.year ?? "?"} ${s.heading ?? s.article.title}`,
      s.body,
      [...SOURCE_LEAKS, ...TYPOS],
    );
  }

  /*
   * --- the commissioner's own history, preserved verbatim -------------------
   *
   * These are transcriptions of the commissioner's written recaps, kept as
   * source. Only the SOURCE_LEAKS check applies: the whitespace and punctuation
   * of somebody else's writing is not a defect to be corrected, and the
   * transcription markers ("RECAP PART 2") are what the season articles are
   * generated FROM rather than anything a reader sees — /history renders the
   * generated articles and falls back to this only when none exist.
   */
  const history = await prisma.leagueHistorySection.findMany({
    select: { year: true, title: true, body: true, sectionType: true },
  });
  console.log(`history sections (verbatim source): ${history.length}`);
  for (const h of history) {
    scan("history section", `${h.year ?? "?"} ${h.title}`, h.body, SOURCE_LEAKS);
  }

  // --- report ---------------------------------------------------------------
  console.log("");
  if (findings.length === 0) {
    console.log("Nothing to report.");
    return;
  }

  const byWhere = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = byWhere.get(f.where) ?? [];
    list.push(f);
    byWhere.set(f.where, list);
  }

  console.log(`${findings.length} finding(s):\n`);
  for (const [where, list] of [...byWhere.entries()].sort()) {
    console.log(`── ${where} (${list.length}) ─────────────────────────────`);
    const byProblem = new Map<string, Finding[]>();
    for (const f of list) {
      const l = byProblem.get(f.problem) ?? [];
      l.push(f);
      byProblem.set(f.problem, l);
    }
    for (const [problem, l] of byProblem) {
      console.log(`  ${problem} — ${l.length}`);
      for (const f of l.slice(0, 4)) console.log(`      ${f.subject}: …${f.excerpt}…`);
      if (l.length > 4) console.log(`      … and ${l.length - 4} more`);
    }
    console.log("");
  }
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
