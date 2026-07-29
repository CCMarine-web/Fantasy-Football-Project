import { describe, expect, it } from "vitest";
import { generateChatCode, normaliseName } from "./identity";

/**
 * Name normalisation is the whole impersonation defence: a reservation is only
 * as good as the set of spellings it catches. The database-backed halves
 * (loadReservedNames, resolveChatCode) are exercised through the posting path.
 */

describe("normaliseName", () => {
  it("ignores case, spacing and punctuation", () => {
    const canonical = normaliseName("Michael Shea");
    expect(normaliseName("michael shea")).toBe(canonical);
    expect(normaliseName("MichaelShea")).toBe(canonical);
    expect(normaliseName("M-i-c-h-a-e-l S-h-e-a")).toBe(canonical);
    expect(normaliseName("  Michael   Shea!!  ")).toBe(canonical);
    expect(normaliseName("Michael.Shea")).toBe(canonical);
  });

  it("strips accents so a decorated spelling still matches", () => {
    expect(normaliseName("Míchael Shéa")).toBe(normaliseName("Michael Shea"));
  });

  it("does not merge genuinely different names", () => {
    expect(normaliseName("Michael Shea")).not.toBe(normaliseName("Michael Sheahan"));
    expect(normaliseName("Patrick McManus")).not.toBe(normaliseName("Patrick Schwing"));
  });

  it("reduces a name of pure punctuation to nothing, so it reserves nothing", () => {
    expect(normaliseName("!!!")).toBe("");
    expect(normaliseName("   ")).toBe("");
  });
});

describe("generateChatCode", () => {
  it("produces four readable groups of four", () => {
    expect(generateChatCode()).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("omits the characters people misread when typing a code off a phone", () => {
    const codes = Array.from({ length: 40 }, generateChatCode).join("");
    for (const ambiguous of ["O", "0", "I", "1", "L"]) {
      expect(codes).not.toContain(ambiguous);
    }
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 50 }, generateChatCode));
    expect(codes.size).toBe(50);
  });
});
