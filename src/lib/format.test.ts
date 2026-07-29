import { describe, expect, it } from "vitest";
import { ordinal, ordinalSuffix } from "./format";

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
