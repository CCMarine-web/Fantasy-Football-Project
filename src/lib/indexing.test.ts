import { describe, expect, it } from "vitest";
import { canonicalUrl, isIndexablePath, pageMetadata, robotsHeaderFor } from "./indexing";

const www = "www.rattrapfantasy.com";

describe("indexing allowlist", () => {
  it("indexes only allowlisted paths on the www host without a query", () => {
    expect(robotsHeaderFor({ host: www, pathname: "/", search: "" })).toBeNull();
    expect(robotsHeaderFor({ host: www, pathname: "/standings", search: "" })).toBeNull();
    expect(robotsHeaderFor({ host: www, pathname: "/about", search: "" })).toBeNull();
  });

  it("keeps everything else noindex, follow", () => {
    expect(robotsHeaderFor({ host: www, pathname: "/managers/ethan-jones", search: "" })).toBe("noindex, follow");
    expect(robotsHeaderFor({ host: www, pathname: "/hall-of-shame", search: "" })).toBe("noindex, follow");
    expect(robotsHeaderFor({ host: www, pathname: "/standings", search: "?x=1" })).toBe("noindex, follow");
    expect(robotsHeaderFor({ host: www, pathname: "/standings/2024", search: "" })).toBe("noindex, follow");
  });

  it("noindexes every other host", () => {
    expect(robotsHeaderFor({ host: "fantasy-football-project-abc123.vercel.app", pathname: "/", search: "" })).toBe("noindex, nofollow");
    expect(robotsHeaderFor({ host: null, pathname: "/", search: "" })).toBe("noindex, nofollow");
  });

  it("builds query-free canonical URLs on www", () => {
    expect(canonicalUrl("/")).toBe("https://www.rattrapfantasy.com/");
    expect(canonicalUrl("/standings/")).toBe("https://www.rattrapfantasy.com/standings");
    expect(isIndexablePath("/records/")).toBe(true);
  });

  it("page metadata follows the list", () => {
    expect(pageMetadata("/standings", { title: "Standings", description: "d" }).robots).toEqual({ index: true, follow: true });
    expect(pageMetadata("/managers", { title: "Managers", description: "d" }).robots).toEqual({ index: false, follow: true });
  });
});
