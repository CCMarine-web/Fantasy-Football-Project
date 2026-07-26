import { describe, expect, it } from "vitest";

import { LEAGUE_CONFIG } from "./league-config";

/**
 * The draft countdown is only correct if the configured instant really is
 * 5:00 PM in America/Chicago. An offset typo (e.g. -06:00 during CDT) would
 * silently shift the countdown by an hour, so pin the absolute instant here.
 */
describe("LEAGUE_CONFIG.draftDate", () => {
  const target = new Date(LEAGUE_CONFIG.draftDate);

  it("is a valid date", () => {
    expect(Number.isNaN(target.getTime())).toBe(false);
  });

  it("lands on 5:00 PM America/Chicago, Sat Sep 5 2026", () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(target);
    const get = (t: string) => parts.find((p) => p.type === t)?.value;

    expect(get("year")).toBe("2026");
    expect(get("month")).toBe("09");
    expect(get("day")).toBe("05");
    expect(get("hour")).toBe("17");
    expect(get("minute")).toBe("00");
    expect(get("weekday")).toBe("Sat");
  });

  it("is the UTC instant 2026-09-05T22:00:00Z (CDT = UTC-5)", () => {
    expect(target.toISOString()).toBe("2026-09-05T22:00:00.000Z");
  });

  it("declares the timezone the draft time is quoted in", () => {
    expect(LEAGUE_CONFIG.draftTimeZone).toBe("America/Chicago");
  });
});
