/**
 * Deterministic gates on generated copy.
 *
 * ── Why these are code and not prompt lines ────────────────────────────────
 * The manager-profile prompt has said "never reveal or imply that a group chat
 * exists or was analysed" for weeks. The profiles it produced still opened with
 * "runs the group chat like a betting column with memes attached", described a
 * manager as "meme-forward" and referred to a "chat persona" — three separate
 * managers, all published. An instruction the writer can weigh against another
 * instruction ("let the personality material shape the voice") is a preference.
 * A check that refuses the draft is a rule.
 *
 * Everything here is pure string work: no I/O, no Prisma, no provider. It is
 * used by the generators to force a corrective retry, and by
 * scripts/audit/content-audit.ts to check what is already saved.
 */

/**
 * Vocabulary that reveals HOW the league's personality material was obtained.
 *
 * The material itself is fine to use — it is what makes a profile read like it
 * came from inside the league. Naming its source is not: a reader should meet a
 * sports profile, not a note about text-message analysis.
 *
 * Each entry is deliberately narrow. "archive" is absent because "ESPN does not
 * retain transactions for archived seasons" is an honest sentence about a
 * fantasy platform that appears in five season articles and should stay.
 */
const SOURCE_DISCLOSURE: { label: string; pattern: RegExp }[] = [
  {
    label: "the group chat",
    pattern:
      /\bgroup[ -]?chat\b|\bthe chat\b|\bin chat\b|\boff chat\b|\bon chat\b|\bchat (?:persona|log|archive|history|room|thread)\b/i,
  },
  { label: "text messages", pattern: /\btexts\b|\btexting\b|\btext messages?\b|\bSMS\b/i },
  { label: "memes", pattern: /\bmemes?\b|\bmeme[- ](?:forward|heavy|drops?)\b/i },
  { label: '"chatter"', pattern: /\bchatter\b/i },
  {
    label: "an archive of conversations",
    pattern: /\b(?:conversation|message|chat)\s+(?:archive|history|corpus|dump|export)\b/i,
  },
  {
    label: "AI or personality extraction",
    pattern:
      /\b(?:the|our|this)\s+(?:model|algorithm|AI)\b|\bAI-(?:generated|written|extracted|derived)\b|\bpersonality (?:profile|extraction|analysis)\b|\bLLM\b|\blanguage model\b/i,
  },
  {
    label: "a messaging platform",
    pattern: /\bgroup ?me\b|\bimessage\b|\bwhatsapp\b|\bdiscord\b|\bDMs\b/i,
  },
  { label: "the thread", pattern: /\bthe thread\b|\bthreads?\b(?=\s+(?:going|moving|alive))/i },
];

export interface SourceDisclosure {
  label: string;
  excerpt: string;
}

/**
 * Every place the text gives away where the personality material came from.
 * Empty means the copy is publishable on this axis.
 */
export function findSourceDisclosures(text: string): SourceDisclosure[] {
  const out: SourceDisclosure[] = [];
  for (const { label, pattern } of SOURCE_DISCLOSURE) {
    const match = pattern.exec(text);
    if (!match) continue;
    const at = match.index ?? 0;
    out.push({
      label,
      excerpt: text
        .slice(Math.max(0, at - 50), at + match[0].length + 50)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return out;
}

export function disclosesItsSource(text: string): boolean {
  return findSourceDisclosures(text).length > 0;
}

/**
 * Mechanical defects that have shipped to the live site.
 *
 * These are not style preferences. Each one was read by somebody on a public
 * page: "the closet game was a 1.84-point nail-biter" on an official rivalry
 * card, "the model judges those starters as middling" in a draft grade, and
 * "(R16) , Brandon Aubrey" with a space before the comma.
 */
const MECHANICAL_DEFECTS: { label: string; pattern: RegExp }[] = [
  { label: '"closet" where "closest" was meant', pattern: /\bcloset\s+(?:game|margin|win|loss|call|contest)/i },
  { label: "a leaked camelCase field name", pattern: /\b[a-z]+[A-Z][a-zA-Z]*\s*[:=]/ },
  { label: "a year run into the word before it", pattern: /[a-zA-Z?!]\d{4}\b/ },
  { label: "a doubled ordinal suffix", pattern: /\b\d+(?:st|nd|rd|th)\s*(?:st|nd|rd|th)\b/i },
  {
    label: "a malformed ordinal (1th, 2rd, 11st)",
    pattern: /\b\d*(?:[04-9]|1[1-3])(?:st|nd|rd)\b|\b\d*1th\b|\b\d*2(?:st|rd)\b|\b\d*3(?:st|nd)\b/,
  },
  { label: "a run of spaces inside a line", pattern: /[^\S\n]{2,}\S/ },
  // A period before a digit is a leading-decimal average (".547"), which is how
  // these are written and read.
  { label: "a space before punctuation", pattern: /[^\S\n]+(?:[,;]|\.(?!\d))/ },
  { label: "an unfilled placeholder", pattern: /\b(?:TODO|TBD|lorem ipsum|undefined|NaN)\b/ },
];

export interface EditorialProblem {
  label: string;
  excerpt: string;
}

/**
 * Everything wrong with a piece of copy that can be established without knowing
 * the subject: source disclosure plus mechanical defects. Numeric agreement is a
 * separate job — see scripts/ai/verify-manager-bios.ts and
 * scripts/ai/verify-rivalry-text.ts, which compare copy against the figures
 * printed beside it.
 */
export function findEditorialProblems(text: string): EditorialProblem[] {
  const problems: EditorialProblem[] = findSourceDisclosures(text).map((d) => ({
    label: `discloses its source: ${d.label}`,
    excerpt: d.excerpt,
  }));
  for (const { label, pattern } of MECHANICAL_DEFECTS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const at = match.index ?? 0;
    problems.push({
      label,
      excerpt: text
        .slice(Math.max(0, at - 45), at + match[0].length + 45)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return problems;
}

/**
 * Hindsight, in a piece of copy that is only allowed to know what was knowable
 * at the time.
 *
 * The ORIGINAL draft grade judges draft day. One rationale read "the bench ended
 * up full of low-ceiling veterans", which is a verdict on the season, printed
 * under a heading that says "judged on draft day only". The revisited grade is
 * where hindsight belongs and this check is not applied to it.
 */
const HINDSIGHT: { label: string; pattern: RegExp }[] = [
  {
    label: "outcome language",
    pattern:
      /\b(?:turned out|in hindsight|with hindsight|ended up|wound up|as it happened|proved to be|went on to|would (?:go on to|finish|end))\b/i,
  },
  {
    label: "the season's result",
    pattern:
      /\bfinished the (?:season|year)\b|\bmissed the playoffs\b|\bmade the playoffs\b|\bwon the (?:title|championship|league)\b|\bfinal standings\b|\bfinished \d+(?:st|nd|rd|th)\b/i,
  },
  { label: "later transactions", pattern: /\b(?:on waivers|waiver pickups?|later traded|midseason trade)\b/i },
];

/** Hindsight found in copy that is supposed to be a draft-day judgement. */
export function findHindsight(text: string): EditorialProblem[] {
  const problems: EditorialProblem[] = [];
  for (const { label, pattern } of HINDSIGHT) {
    const match = pattern.exec(text);
    if (!match) continue;
    const at = match.index ?? 0;
    problems.push({
      label: `hindsight in a draft-day judgement: ${label}`,
      excerpt: text
        .slice(Math.max(0, at - 45), at + match[0].length + 45)
        .replace(/\s+/g, " ")
        .trim(),
    });
  }
  return problems;
}

/** The corrective instruction for a draft with mechanical or disclosure defects. */
export function rewriteWithoutProblemsInstruction(problems: EditorialProblem[]): string {
  return [
    "Your draft has problems that would be visible to a reader on the published page. Rewrite it, fixing every one:",
    "",
    ...problems.map((p) => `- ${p.label} — "…${p.excerpt}…"`),
    "",
    "Keep every statistic exactly as it was — these are presentation faults, not factual ones. Do not mention chats, texts, messages, memes, chatter, threads, archives, models, algorithms or analysis in any form.",
  ].join("\n");
}

/**
 * The instruction handed back to the writer on a retry. Naming the exact
 * offending phrases works where a general reminder did not — the first draft
 * already had the general reminder.
 */
export function rewriteWithoutDisclosureInstruction(text: string): string {
  const hits = findSourceDisclosures(text);
  const named = hits.map((h) => `- ${h.label} — "…${h.excerpt}…"`).join("\n");
  return [
    "Your draft gave away where the personality material came from. That is never publishable, however true it is: a reader must meet a sports profile, not a note about how it was researched.",
    "",
    "Specifically:",
    named,
    "",
    "Rewrite the whole piece. Keep the personality — the needling, the reputation, the habits, the way this manager comes across — but attribute it to the LEAGUE and to what they DO, not to a medium. Say \"he is the league's loudest needler\" rather than \"he needles in the chat\"; say \"quick with a one-liner when a lineup backfires\" rather than \"meme-forward\". Do not mention chats, texts, messages, memes, chatter, threads, archives, models or analysis in any form. Every statistic must stay exactly as it was.",
  ].join("\n");
}
