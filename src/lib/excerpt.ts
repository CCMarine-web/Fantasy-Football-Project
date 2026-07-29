/**
 * Turning a long piece of saved prose into a short one.
 *
 * ── Why derive rather than generate ───────────────────────────────────────
 * Both places this is used — the manager cards on /managers and the season
 * previews on /history — need a shorter version of a text that already exists in
 * full elsewhere on the site. Generating a second, independent text about the
 * same subject means the two will eventually disagree, and the short one is the
 * one a reader meets first. Cutting the long one cannot disagree with it.
 *
 * ── The rules ─────────────────────────────────────────────────────────────
 * Take whole paragraphs while they fit. If that lands short of the minimum,
 * top up with whole SENTENCES from the next paragraph — a first paragraph of
 * 93 words and a second of 110 cannot both fit under a 180-word cap, and taking
 * only the first left seven of the ten manager cards below the band a reader was
 * promised. If a single paragraph overruns the cap on its own, fall back to
 * sentences from the start.
 *
 * Never cut mid-sentence and never append an ellipsis: a card ending "…and then
 * he" reads as a bug, whereas one that stops a sentence early just reads short.
 */

export interface ExcerptOptions {
  /** Keep taking paragraphs until at least this many words are in. */
  minWords: number;
  /** Never exceed this, except when a single sentence is longer than the cap. */
  maxWords: number;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Splits into paragraphs on blank lines, trimmed, empties removed. */
export function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Splits prose into sentences, keeping their trailing punctuation and space. */
function sentencesOf(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(?:["'”’)]+)?\s*/g) ?? (text.trim() ? [text] : []);
}

export function excerpt(
  text: string | null | undefined,
  { minWords, maxWords }: ExcerptOptions,
): string | null {
  if (!text) return null;
  const paragraphs = paragraphsOf(text);
  if (paragraphs.length === 0) return null;

  const taken: string[] = [];
  let words = 0;
  let nextIndex = 0;
  for (const paragraph of paragraphs) {
    const next = words + wordCount(paragraph);
    // Always take the first paragraph; take later ones only while they keep the
    // excerpt inside the band.
    if (taken.length > 0 && next > maxWords) break;
    taken.push(paragraph);
    words = next;
    nextIndex += 1;
    if (words >= minWords) break;
  }

  // Short of the minimum with a paragraph left over: top up sentence by
  // sentence, stopping the moment the minimum is met or the cap is reached.
  if (words < minWords && nextIndex < paragraphs.length) {
    const topUp: string[] = [];
    for (const sentence of sentencesOf(paragraphs[nextIndex])) {
      const next = words + wordCount(sentence);
      if (next > maxWords) break;
      topUp.push(sentence);
      words = next;
      if (words >= minWords) break;
    }
    if (topUp.length > 0) taken.push(topUp.join("").trim());
  }

  const joined = taken.join("\n\n");
  if (wordCount(joined) <= maxWords) return joined;

  // A single paragraph longer than the cap: keep whole sentences from the start.
  const kept: string[] = [];
  let n = 0;
  for (const sentence of sentencesOf(joined)) {
    const next = n + wordCount(sentence);
    if (kept.length > 0 && next > maxWords) break;
    kept.push(sentence);
    n = next;
  }
  return kept.join("").trim();
}
