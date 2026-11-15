/**
 * Round axis ticks (the Nov 2026 audit found 117, 132, 147, 163): steps of
 * 1, 2, 2.5 or 5 × a power of ten, covering [min, max].
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min < 1e-9) {
    const pad = Math.max(1, Math.abs(max) * 0.1);
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** "Ethan Jones" -> "Jones"; keeps a whole word, never truncates mid-name. */
export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts.at(-1) as string) : name;
}
