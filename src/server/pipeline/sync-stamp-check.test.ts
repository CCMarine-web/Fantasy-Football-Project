import { describe, expect, it } from "vitest";
import { checkSyncStamps, compareStamps, parseSyncedAt } from "./sync-stamp-check";

const page = (iso: string) => `<p class="x" data-synced-at="${iso}"><span>synced</span></p>`;

describe("sync stamp check", () => {
  it("reads the stamp from the page", () => {
    expect(parseSyncedAt(page("2026-11-15T13:33:00.000Z"))).toBe("2026-11-15T13:33:00.000Z");
    expect(parseSyncedAt("<p>no stamp</p>")).toBeNull();
  });

  it("flags routes whose stamp differs", () => {
    const r = compareStamps({ "/": "a", "/standings": "b", "/news": null }, "b");
    expect(r.ok).toBe(false);
    expect(r.mismatched.map((m) => m.route)).toEqual(["/", "/news"]);
  });

  it("retries until stale pages have rebuilt", async () => {
    let calls = 0;
    const result = await checkSyncStamps({
      base: "https://example.test",
      expected: "new",
      routes: ["/", "/standings"],
      delayMs: 0,
      // First pass: the home page is still the old build.
      fetcher: async (url) => {
        calls += 1;
        return page(url.endsWith("/") && calls <= 1 ? "old" : "new");
      },
    });
    expect(result.ok).toBe(true);
    expect(result.passes).toBe(2);
  });

  it("reports what is still wrong after the last pass", async () => {
    const result = await checkSyncStamps({
      base: "https://example.test",
      expected: "new",
      routes: ["/", "/standings"],
      passes: 2,
      delayMs: 0,
      fetcher: async (url) => page(url.endsWith("/standings") ? "old" : "new"),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("/standings (old)");
  });
});
