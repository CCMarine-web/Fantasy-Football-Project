import { describe, expect, it } from "vitest";
import { lastName, niceTicks } from "./chart-ticks";

describe("niceTicks", () => {
  it("gives round values covering the range", () => {
    const t = niceTicks(117.4, 163.2, 4);
    expect(t[0]).toBeLessThanOrEqual(117.4);
    expect(t.at(-1)).toBeGreaterThanOrEqual(163.2);
    for (const v of t) expect(v % 5).toBe(0);
  });
  it("is symmetric around zero for a diverging axis", () => {
    expect(niceTicks(-3.2, 3.2, 4)).toEqual([-4, -2, 0, 2, 4]);
  });
});

describe("lastName", () => {
  it("never truncates mid-word", () => {
    expect(lastName("Ethan Jones")).toBe("Jones");
    expect(lastName("Anthony Cibilich")).toBe("Cibilich");
    expect(lastName("Prince")).toBe("Prince");
  });
});
