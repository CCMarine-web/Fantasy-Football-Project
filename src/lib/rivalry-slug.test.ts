import { describe, expect, it } from "vitest";
import { resolveRivalryParam, rivalryPath, rivalrySlug } from "./rivalry-slug";

const entries = [
  { id: "cl_rivalry_1", managerAName: "Gavin Detillier", managerBName: "Anthony Cibilich" },
  { id: "cl_rivalry_2", managerAName: "Patrick O’Neil", managerBName: "José Núñez" },
];

describe("rivalrySlug / rivalryPath", () => {
  it("joins the slugified names in A/B order", () => {
    expect(rivalrySlug("Gavin Detillier", "Anthony Cibilich")).toBe("gavin-detillier-vs-anthony-cibilich");
    expect(rivalryPath("Gavin Detillier", "Anthony Cibilich")).toBe("/rivalries/gavin-detillier-vs-anthony-cibilich");
  });

  it("uses the shared slugify rules (accents, apostrophes)", () => {
    expect(rivalrySlug("Patrick O’Neil", "José Núñez")).toBe("patrick-oneil-vs-jose-nunez");
  });
});

describe("resolveRivalryParam", () => {
  it("resolves the canonical slug without a redirect", () => {
    expect(resolveRivalryParam(entries, "gavin-detillier-vs-anthony-cibilich")).toEqual({
      id: "cl_rivalry_1",
      slug: "gavin-detillier-vs-anthony-cibilich",
      shouldRedirect: false,
    });
  });

  it("is case-insensitive", () => {
    expect(resolveRivalryParam(entries, "Gavin-Detillier-vs-Anthony-Cibilich")?.shouldRedirect).toBe(false);
  });

  it("redirects the reversed order to the canonical slug", () => {
    expect(resolveRivalryParam(entries, "anthony-cibilich-vs-gavin-detillier")).toEqual({
      id: "cl_rivalry_1",
      slug: "gavin-detillier-vs-anthony-cibilich",
      shouldRedirect: true,
    });
  });

  it("redirects a legacy id to the canonical slug", () => {
    expect(resolveRivalryParam(entries, "cl_rivalry_2")).toEqual({
      id: "cl_rivalry_2",
      slug: "patrick-oneil-vs-jose-nunez",
      shouldRedirect: true,
    });
  });

  it("returns null for an unknown param", () => {
    expect(resolveRivalryParam(entries, "nobody-vs-anybody")).toBeNull();
    expect(resolveRivalryParam([], "gavin-detillier-vs-anthony-cibilich")).toBeNull();
  });
});
