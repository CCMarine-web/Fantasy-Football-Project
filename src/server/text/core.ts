import { createHash } from "node:crypto";
import type { VoiceContentType } from "@/server/ai/voice";

/**
 * FACTS-FIRST TEXT — the pure core (no I/O).
 *
 *   1. Facts first      every text is written from a structured `facts` object
 *                       built by the same functions that render the page.
 *   2. Tokens           key stats (records, series, scores, luck, ranks,
 *                       streaks) are written as {{token}} and filled from the
 *                       CURRENT facts when the page renders.
 *   3. Checked numbers  every literal number, ordinal and W-L left in the prose
 *                       must appear in the facts (allowing for rounding).
 *   4. Provenance       asOfSeason / asOfWeek / model / inputHash are stored.
 *   5. Only on change   a text is regenerated when its facts' hash changes.
 *   6. Never stale      a text whose hash no longer matches renders its
 *                       templated fallback instead.
 */

export type TextKind =
  | "MATCHUP_PREVIEW"
  | "MATCHUP_RECAP"
  | "POWER_BLURB"
  | "WEEKLY_AWARDS"
  | "RIVALRY"
  | "MANAGER_BIO"
  | "SCOUTING"
  | "DRAFT_REVISIT"
  | "TRADE_VERDICT"
  | "SEASON_RETRO"
  | "NEWS_ISSUE";

/** Bump to regenerate everything (prompt or rule changes). */
export const TEXT_ENGINE_VERSION = 1;

export type Facts = Record<string, unknown>;

export interface TextSpec {
  kind: TextKind;
  subjectKey: string;
  asOfSeason: number;
  asOfWeek: number | null;
  /** Everything the writer may use. Hashed; sent to the model; validated against. */
  facts: Facts;
  /** token name -> display string. The writer uses {{name}}; render fills it. */
  tokens: Record<string, string>;
  /** Which voice examples to use. */
  contentType: VoiceContentType;
  /** What to write: subject, angle, length. */
  task: string;
  /** Templated text (may use tokens) shown when no valid AI text exists. */
  fallback: string;
  /** Soft length cap for the prompt. */
  maxWords: number;
  /**
   * Figures that belong to one time frame only. A sentence about "this
   * season" that quotes a career-only figure is rejected (a bio once called
   * the career Luck Score this season's).
   */
  scopes?: { season: string[]; career: string[] };
}

/** Stable JSON: keys sorted, so the hash doesn't depend on insertion order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as object)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function specHash(spec: Pick<TextSpec, "kind" | "facts" | "task">): string {
  return createHash("sha256")
    .update(stableStringify({ v: TEXT_ENGINE_VERSION, kind: spec.kind, task: spec.task, facts: spec.facts }))
    .digest("hex")
    .slice(0, 32);
}

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Tokens used in a template. */
export function tokensIn(template: string): string[] {
  return [...template.matchAll(TOKEN)].map((m) => m[1]);
}

/** Fills {{tokens}}; an unknown token renders as an em dash and is reported. */
export function renderTemplate(template: string, tokens: Record<string, string>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(TOKEN, (_, name: string) => {
    if (name in tokens) return tokens[name];
    missing.push(name);
    return "—";
  });
  return { text, missing };
}

// ── The validator ──────────────────────────────────────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};
const COUNT_NOUNS =
  "games?|straight|wins?|loss(?:es)?|titles?|championships?|finals?|seasons?|trips?|appearances?|meetings?|weeks?|playoffs?|berths?|points?|trades?|pickups?|claims?|picks?|rounds?|times?";
const WORD_NUMBER_RE = new RegExp(`\\b(${Object.keys(WORD_NUMBERS).join("|")})[-\\s](?:${COUNT_NOUNS})\\b`, "gi");
const RECORD_RE = /(?<![\d.])(\d{1,3})-(\d{1,3})(?:-(\d{1,2}))?(?![\d.])/g;
const NUMBER_RE = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:st|nd|rd|th)?(?![\w])/g;

export interface AllowedFacts {
  numbers: number[];
  records: Set<string>;
}

/** Every number and W-L string the facts contain, in any field, at any depth. */
export function collectAllowed(facts: unknown, tokens: Record<string, string> = {}): AllowedFacts {
  const numbers: number[] = [];
  const records = new Set<string>();
  const fromString = (s: string) => {
    for (const m of s.matchAll(RECORD_RE)) records.add(m[0]);
    for (const m of s.matchAll(NUMBER_RE)) numbers.push(Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`));
  };
  const walk = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) numbers.push(v, Math.abs(v));
    else if (typeof v === "string") fromString(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Any object with wins/losses is a record the prose may quote.
      const w = o.wins ?? o.w;
      const l = o.losses ?? o.l;
      if (typeof w === "number" && typeof l === "number") {
        const t = typeof o.ties === "number" && o.ties > 0 ? `-${o.ties}` : "";
        records.add(`${w}-${l}${t}`);
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(facts);
  Object.values(tokens).forEach(fromString);
  return { numbers, records };
}

function numberAllowed(value: number, decimals: number, allowed: number[]): boolean {
  const tol = decimals === 0 ? 0.5 : decimals === 1 ? 0.051 : 0.0051;
  return allowed.some((a) => {
    if (Math.abs(a - value) < 1e-9) return true;
    // A written integer may be a rounded fact (105.3 -> "105"), but only
    // within rounding — never a different number.
    if (decimals === 0) return Number.isInteger(value) && Math.round(a) === value && Math.abs(a - value) <= tol;
    return Math.abs(a - value) <= tol;
  });
}

export interface ValidationResult {
  ok: boolean;
  problems: string[];
}

/**
 * Checks a template against its facts: unknown tokens, numbers not in the
 * facts, W-L records not in the facts, counted number-words not in the facts.
 * Tokens are trusted (they are filled from facts) and stripped first.
 */
const THIS_SEASON = /\b(this season|this year|so far this|this fall|currently|right now|this campaign)\b/i;

/** Sentences about the current season that quote a career-only figure. */
export function scopeProblems(rendered: string, scopes: NonNullable<TextSpec["scopes"]>): string[] {
  const careerOnly = scopes.career.filter((c) => c && !scopes.season.includes(c));
  const problems: string[] = [];
  for (const sentence of rendered.split(/(?<=[.!?])\s+/)) {
    if (!THIS_SEASON.test(sentence)) continue;
    for (const c of careerOnly) {
      if (sentence.includes(c)) problems.push(`a "this season" sentence quotes the career figure "${c}"`);
    }
  }
  return problems;
}

export function validateTemplate(
  template: string,
  facts: Facts,
  tokens: Record<string, string>,
  scopes?: TextSpec["scopes"],
): ValidationResult {
  const problems: string[] = [];
  if (scopes) problems.push(...scopeProblems(renderTemplate(template, tokens).text, scopes));
  for (const name of tokensIn(template)) if (!(name in tokens)) problems.push(`unknown token {{${name}}}`);
  const allowed = collectAllowed(facts, tokens);

  let prose = template.replace(TOKEN, " ");
  for (const m of prose.matchAll(RECORD_RE)) {
    if (!allowed.records.has(m[0])) problems.push(`record "${m[0]}" is not in the facts`);
  }
  prose = prose.replace(RECORD_RE, " ");
  for (const m of prose.matchAll(NUMBER_RE)) {
    const value = Number(`${m[1].replace(/,/g, "")}${m[2] ? `.${m[2]}` : ""}`);
    if (!numberAllowed(value, m[2]?.length ?? 0, allowed.numbers)) problems.push(`number "${m[0]}" is not in the facts`);
  }
  for (const m of prose.matchAll(WORD_NUMBER_RE)) {
    const value = WORD_NUMBERS[m[1].toLowerCase()];
    if (!numberAllowed(value, 0, allowed.numbers)) problems.push(`"${m[0]}" is not supported by the facts`);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

/** The writer's instructions, shared by every kind. */
export function buildUserPrompt(spec: TextSpec, previous?: { draft: string; problems: string[] }): string {
  const tokenList = Object.entries(spec.tokens)
    .map(([k, v]) => `  {{${k}}} = ${v}`)
    .join("\n");
  const base = [
    spec.task,
    `Write at most ${spec.maxWords} words of plain prose. No headings, no bullet points, no markdown.`,
    "FACTS (the only source of truth — use nothing else, never invent a number, record, streak, rank or event):",
    JSON.stringify(spec.facts, null, 1),
    "TOKENS — for these stats write the token exactly (with the double braces) instead of the number; the site fills them in:",
    tokenList || "  (none)",
    "Any other number you write must appear in FACTS exactly, or rounded to one decimal. Spell records as W-L exactly as FACTS gives them. Do not convert numbers to words. If a fact isn't in FACTS, leave it out.",
    "Don't recite every stat — pick the two or three that tell the story, and make it fun to read.",
  ].join("\n\n");
  if (!previous) return base;
  return `${base}\n\nYour previous draft was rejected: ${previous.problems.join("; ")}. Rewrite it so every number comes from FACTS or a token.\n\nPrevious draft:\n${previous.draft}`;
}
