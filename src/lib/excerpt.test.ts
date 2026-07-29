import { describe, expect, it } from "vitest";
import { excerpt, paragraphsOf, wordCount } from "./excerpt";

/** n words, as one sentence ending in a full stop. */
function sentence(n: number, marker = "word"): string {
  return `${Array.from({ length: n - 1 }, () => marker).join(" ")} end.`;
}

const BAND = { minWords: 120, maxWords: 180 };

describe("excerpt", () => {
  it("returns null for nothing", () => {
    expect(excerpt(null, BAND)).toBeNull();
    expect(excerpt(undefined, BAND)).toBeNull();
    expect(excerpt("", BAND)).toBeNull();
    expect(excerpt("   \n\n  ", BAND)).toBeNull();
  });

  it("returns a single short paragraph unchanged", () => {
    const text = sentence(40);
    expect(excerpt(text, BAND)).toBe(text);
  });

  it("stops taking paragraphs once the minimum is met", () => {
    const text = [sentence(130), sentence(130), sentence(130)].join("\n\n");
    const result = excerpt(text, BAND)!;
    expect(paragraphsOf(result)).toHaveLength(1);
    expect(wordCount(result)).toBe(130);
  });

  it("tops up from the next paragraph when the first lands short", () => {
    /*
     * The real defect. A 93-word opening paragraph and a 110-word second cannot
     * both fit under 180, so taking only whole paragraphs left seven of the ten
     * manager cards below the 120-word floor a reader was promised.
     */
    const first = [sentence(30), sentence(30), sentence(33)].join(" ");
    const second = [sentence(35), sentence(40), sentence(35)].join(" ");
    expect(wordCount(first)).toBeLessThan(BAND.minWords);
    expect(wordCount(`${first} ${second}`)).toBeGreaterThan(BAND.maxWords);

    const result = excerpt([first, second].join("\n\n"), BAND)!;
    expect(wordCount(result)).toBeGreaterThanOrEqual(BAND.minWords);
    expect(wordCount(result)).toBeLessThanOrEqual(BAND.maxWords);
  });

  it("never ends mid-sentence and never adds an ellipsis", () => {
    const text = [sentence(50), [sentence(40), sentence(40), sentence(40)].join(" ")].join("\n\n");
    const result = excerpt(text, BAND)!;
    expect(result).not.toContain("…");
    expect(result).not.toContain("...");
    expect(result.trimEnd().endsWith(".")).toBe(true);
  });

  it("cuts a single over-long paragraph at a sentence boundary", () => {
    const text = [sentence(90), sentence(90), sentence(90)].join(" ");
    const result = excerpt(text, BAND)!;
    expect(wordCount(result)).toBeLessThanOrEqual(BAND.maxWords);
    expect(result.trimEnd().endsWith(".")).toBe(true);
  });

  it("keeps the first sentence even when it alone exceeds the cap", () => {
    // Better one long sentence than an empty card.
    const text = sentence(300);
    const result = excerpt(text, BAND)!;
    expect(result).toBe(text);
  });

  it("respects a different band", () => {
    const text = Array.from({ length: 8 }, () => sentence(60)).join("\n\n");
    const result = excerpt(text, { minWords: 150, maxWords: 250 })!;
    expect(wordCount(result)).toBeGreaterThanOrEqual(150);
    expect(wordCount(result)).toBeLessThanOrEqual(250);
  });

  it("is stable across calls", () => {
    const text = [sentence(80), sentence(80), sentence(80)].join("\n\n");
    expect(excerpt(text, BAND)).toBe(excerpt(text, BAND));
  });
});

describe("paragraphsOf", () => {
  it("splits on blank lines and drops empties", () => {
    expect(paragraphsOf("one\n\ntwo\n\n\n\nthree")).toEqual(["one", "two", "three"]);
  });

  it("does not split on a single newline", () => {
    expect(paragraphsOf("one\ntwo")).toEqual(["one\ntwo"]);
  });
});

describe("wordCount", () => {
  it("counts words the way a reader would", () => {
    expect(wordCount("one two three")).toBe(3);
    expect(wordCount("  one   two  ")).toBe(2);
    expect(wordCount("")).toBe(0);
  });
});
