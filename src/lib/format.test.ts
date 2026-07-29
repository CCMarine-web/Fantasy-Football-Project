import { describe, expect, it } from "vitest";
import { distributePercentages, ordinal, ordinalSuffix } from "./format";

describe("ordinal", () => {
  it("uses st/nd/rd for 1, 2, 3", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(3)).toBe("3rd");
  });

  it("uses th for the 11-13 exception", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(112)).toBe("112th");
  });

  it("fixes the cases the site was getting wrong", () => {
    // "61th percentile" and "23th pick" were both live.
    expect(ordinal(61)).toBe("61st");
    expect(ordinal(23)).toBe("23rd");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(101)).toBe("101st");
  });

  it("handles round tens and hundreds", () => {
    expect(ordinal(10)).toBe("10th");
    expect(ordinal(20)).toBe("20th");
    expect(ordinal(100)).toBe("100th");
  });

  it("exposes the bare suffix", () => {
    expect(ordinalSuffix(1)).toBe("st");
    expect(ordinalSuffix(14)).toBe("th");
  });
});

describe("distributePercentages", () => {
  it("fixes the draft report card that published 99%", () => {
    /*
     * The real case. DRAFT_WEIGHTS has eight factors; this league has no ADP,
     * bye weeks or risk data, so five survive — 0.20, 0.16, 0.12, 0.10, 0.08 —
     * and are rescaled by their 0.66 total. The rescaled shares sum to exactly
     * 1, but Math.round on each gives 30/24/18/15/12, and every graded season
     * published that 99% under the heading "the weights actually used".
     */
    const total = 0.2 + 0.16 + 0.12 + 0.1 + 0.08;
    const weights = [0.2, 0.16, 0.12, 0.1, 0.08].map((w) => w / total);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(weights.map((w) => Math.round(w * 100)).reduce((a, b) => a + b, 0)).toBe(99);

    const shown = distributePercentages(weights);
    expect(shown.reduce((a, b) => a + b, 0)).toBe(100);
    // The spare point goes to the largest discarded fraction, which is the
    // biggest factor here.
    expect(shown).toEqual([31, 24, 18, 15, 12]);
  });

  it("leaves an already-exact set alone", () => {
    expect(distributePercentages([0.4, 0.3, 0.2, 0.1])).toEqual([40, 30, 20, 10]);
  });

  it("always totals 100 for awkward splits", () => {
    for (const n of [3, 6, 7, 9, 11, 13]) {
      const equal = Array.from({ length: n }, () => 1 / n);
      expect(distributePercentages(equal).reduce((a, b) => a + b, 0)).toBe(100);
    }
  });

  it("gives leftover points to the largest remainders", () => {
    // Three equal thirds: 33.33 each, so two entries get the spare points and
    // ties break toward the earlier entry.
    expect(distributePercentages([1 / 3, 1 / 3, 1 / 3])).toEqual([34, 33, 33]);
  });

  it("normalises a set that does not already sum to 1", () => {
    expect(distributePercentages([2, 1, 1])).toEqual([50, 25, 25]);
  });

  it("is deterministic across calls", () => {
    const weights = [0.2985, 0.2388, 0.1791, 0.1493, 0.1194];
    expect(distributePercentages(weights)).toEqual(distributePercentages(weights));
  });

  it("handles the degenerate cases without dividing by zero", () => {
    expect(distributePercentages([])).toEqual([]);
    expect(distributePercentages([0, 0])).toEqual([0, 0]);
    expect(distributePercentages([1])).toEqual([100]);
  });
});
