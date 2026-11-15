/**
 * The form strip, one component everywhere it appears (matchup card, standings).
 *
 * Always oldest → newest, always labelled with the window it covers, and every
 * chip carries the week, the opponent and the score in its tooltip — a bare
 * "L W L" invited readers to guess which end was the latest game.
 */

export interface FormChipData {
  result: "W" | "L" | "T";
  week: number;
  opponentName?: string | null;
  score?: number | null;
  opponentScore?: number | null;
}

function chipTitle(chip: FormChipData): string {
  const outcome = chip.result === "W" ? "Won" : chip.result === "L" ? "Lost" : "Tied";
  const vs = chip.opponentName ? ` vs ${chip.opponentName}` : "";
  const score =
    chip.score != null && chip.opponentScore != null
      ? ` ${chip.score.toFixed(1)}–${chip.opponentScore.toFixed(1)}`
      : "";
  return `Week ${chip.week}: ${outcome}${vs}${score}`;
}

export function FormChips({
  form,
  label,
  showLabel = true,
}: {
  form: FormChipData[];
  /** e.g. "Form entering Week 9". "oldest → newest" is appended. */
  label: string;
  showLabel?: boolean;
}) {
  if (form.length === 0) return null;
  const fullLabel = `${label}, oldest → newest`;
  return (
    <span className="inline-flex flex-col gap-0.5">
      {showLabel ? (
        <span className="text-[11px] leading-none text-muted-foreground">{fullLabel}</span>
      ) : null}
      <span className="flex items-center gap-1" role="list" aria-label={fullLabel}>
        {form.map((chip) => (
          <span
            key={chip.week}
            role="listitem"
            title={chipTitle(chip)}
            aria-label={chipTitle(chip)}
            className={`flex h-5 w-5 cursor-default items-center justify-center rounded-sm text-[11px] font-bold ${
              chip.result === "W"
                ? "bg-field/20 text-field"
                : chip.result === "L"
                  ? "bg-destructive/20 text-destructive"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            {chip.result}
          </span>
        ))}
      </span>
    </span>
  );
}
