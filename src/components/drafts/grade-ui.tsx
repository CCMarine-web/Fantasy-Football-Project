import type { GradeLetter } from "@/generated/prisma/client";
import { gradeLetterToDisplay } from "@/server/repositories/draft-grade-repository";
import type { DraftFactor } from "@/server/stats/draft-quality";
import { distributePercentages } from "@/lib/format";

/**
 * Shared pieces of the draft pages (Grades and Revisited tabs).
 */

/** The last season imported from ESPN; Sleeper seasons start the year after. */
export const LAST_ESPN_SEASON = 2022;

/**
 * Whole-number percentages for a set of weights, guaranteed to total 100.
 *
 * The weights themselves already sum to 1.0000 — they are rescaled in
 * draft-quality.ts when a factor is dropped. What did not add up was the
 * DISPLAY: rounding 0.2985, 0.2388, 0.1791, 0.1493 and 0.1194 one at a time
 * gives 30/24/18/15/12, and every graded season on this page published a
 * methodology panel totalling ninety-nine percent. See distributePercentages.
 */
export function weightPercents(weights: { weight: number }[]): number[] {
  return distributePercentages(weights.map((w) => w.weight));
}

/** How well the recorded data supports a grade. */
export const CONFIDENCE_LABEL = {
  HIGH: "High data confidence",
  MEDIUM: "Medium data confidence",
  LOW: "Low data confidence",
} as const;

/**
 * Color family for a grade: A field green, B primary blue, C neutral, D a red
 * tint, F solid red. Theme tokens only — the C band was a leftover amber, and
 * the scale has no gold in it. Every chip clears 4.5:1.
 */
export function gradeColorClasses(grade: GradeLetter | null): string {
  if (!grade) return "bg-muted text-muted-foreground";
  if (grade.startsWith("A")) return "bg-field/15 text-field";
  if (grade.startsWith("B")) return "bg-primary/15 text-primary";
  if (grade.startsWith("C")) return "bg-muted text-muted-foreground";
  if (grade === "D") return "bg-destructive/10 text-destructive";
  return "bg-destructive text-background"; // F
}

/** Best to worst, for sorting by letter. */
export const GRADE_ORDER: GradeLetter[] = [
  "A_PLUS",
  "A",
  "A_MINUS",
  "B_PLUS",
  "B",
  "B_MINUS",
  "C_PLUS",
  "C",
  "C_MINUS",
  "D",
  "F",
];

/**
 * Joins confidence reasons into one sentence. The reasons are clauses written
 * to follow a semicolon, so the first needs its capital and the end a stop.
 */
export function asSentence(reasons: string[]): string {
  const text = reasons.join("; ").replace(/\.$/, "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** The season-wide ADP caveat, which the methodology panel already states. */
export const ADP_REASON = /average draft position/i;

export function FactorBar({ factor, percent }: { factor: DraftFactor; percent: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-[13px] text-muted-foreground">
        {factor.label} <span className="text-muted-foreground/60">{percent}%</span>
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(2, factor.value)}%` }} />
      </div>
      <span className="w-32 shrink-0 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
        {factor.raw}
      </span>
    </div>
  );
}

export function GradeChip({ grade, size = "sm", title }: { grade: GradeLetter | null; size?: "sm" | "summary" | "md" | "lg"; title?: string }) {
  const sizing =
    size === "lg"
      ? "h-14 w-14 rounded-lg text-2xl"
      : size === "summary"
        ? "h-9 w-9 rounded-lg text-base"
        : size === "md"
        ? "h-11 w-11 rounded-lg text-lg"
        : "h-7 min-w-9 rounded px-1.5 text-sm";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-heading font-bold tabular-nums ${sizing} ${gradeColorClasses(grade)}`}
      title={title}
    >
      {gradeLetterToDisplay(grade)}
    </span>
  );
}
