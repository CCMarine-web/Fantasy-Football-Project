// Deterministic seeded PRNG (mulberry32) + small helpers. Using this instead
// of Math.random() directly means re-running `npm run db:seed` produces the
// exact same league history every time, which is required for the "safe to
// re-run" idempotency guarantee — the script clears all tables and rebuilds
// identical data rather than upserting drifting random values.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed seed constant — do not change, or every downstream row changes. */
export const SEED_CONSTANT = 194_902_017;

export class Rng {
  private readonly next: () => number;

  constructor(seed: number = SEED_CONSTANT) {
    this.next = mulberry32(seed);
  }

  /** Uniform float in [0, 1). */
  random(): number {
    return this.next();
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return this.random() * (max - min) + min;
  }

  /** Approximately-normal value via Box-Muller transform. */
  gaussian(mean: number, stdDev: number): number {
    const u1 = Math.max(this.random(), 1e-9);
    const u2 = this.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /** Random element of a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("Rng.pick: empty array");
    return arr[this.int(0, arr.length - 1)] as T;
  }

  /** Fisher-Yates shuffle, returns a new array (does not mutate input). */
  shuffle<T>(arr: readonly T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }

  /** True with probability p (default 0.5). */
  bool(p = 0.5): boolean {
    return this.random() < p;
  }

  /** Round to N decimal places (default 1, matching fantasy-score display). */
  round(value: number, decimals = 1): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
