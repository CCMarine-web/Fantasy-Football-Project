import { describe, expect, it } from "vitest";
import { collectAllowed, renderTemplate, specHash, stableStringify, validateTemplate } from "./core";

const facts = {
  series: { leader: "Michael Shea", wins: 11, losses: 8, games: 19, text: "Michael Shea leads 11-8" },
  streak: { holder: "Michael Barkemeyer", length: 5 },
  points: { a: 2239.9, b: 2281.04 },
  luckScore: 50,
  ppg: 105.33,
  rank: 3,
};
const tokens = { series: "Michael Shea leads 11-8", streak: "5" };

describe("validateTemplate — numbers must come from the facts", () => {
  it("accepts tokens and numbers present in the facts (with rounding)", () => {
    const t = "{{series}} across 19 meetings, and Barkemeyer has won {{streak}} straight. Shea has 2,281.0 points; PPG 105.3, ranked 3rd.";
    expect(validateTemplate(t, facts, tokens)).toEqual({ ok: true, problems: [] });
  });

  it("rejects the Nov-2026 rivalry write-up's invented record and streak", () => {
    const t = "Michael Shea holds the upper hand: 12-7 across 19 meetings, and Barkemeyer arrives on a four-game winning streak.";
    const r = validateTemplate(t, facts, tokens);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('record "12-7" is not in the facts');
    expect(r.problems.some((p) => p.includes("four-game"))).toBe(true);
  });

  it("rejects a stale luck score and a misquoted percentage", () => {
    const r = validateTemplate("The Luck Score sits at 48, and lineups hit 86.7% of optimal.", facts, tokens);
    expect(r.problems).toEqual(['number "48" is not in the facts', 'number "86.7" is not in the facts']);
  });

  it("does not let an integer stand in for a different decimal", () => {
    expect(validateTemplate("averaging 105 a week", facts, tokens).ok).toBe(true);
    expect(validateTemplate("averaging 106 a week", facts, tokens).ok).toBe(false);
  });

  it("flags unknown tokens", () => {
    expect(validateTemplate("{{bogus}} leads", facts, tokens).problems).toEqual(["unknown token {{bogus}}"]);
  });

  it("collects W-L records from any object with wins and losses", () => {
    expect(collectAllowed({ team: { wins: 6, losses: 3 } }).records.has("6-3")).toBe(true);
  });
});

describe("renderTemplate", () => {
  it("fills tokens from current facts so numbers can't drift", () => {
    expect(renderTemplate("{{series}} — and counting", tokens).text).toBe("Michael Shea leads 11-8 — and counting");
    expect(renderTemplate("{{nope}}", tokens).missing).toEqual(["nope"]);
  });
});

describe("specHash", () => {
  it("is independent of key order and changes when a fact changes", () => {
    const a = specHash({ kind: "RIVALRY", task: "t", facts: { x: 1, y: { b: 2, a: 1 } } });
    const b = specHash({ kind: "RIVALRY", task: "t", facts: { y: { a: 1, b: 2 }, x: 1 } });
    const c = specHash({ kind: "RIVALRY", task: "t", facts: { x: 2, y: { a: 1, b: 2 } } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 0 }] })).toBe('{"a":[2,{"c":0,"d":1}],"b":1}');
  });
});
