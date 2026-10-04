import { describe, expect, it } from "vitest";
import { deriveWeekStatus, nextKickoff, weekFinalMs, weekKickoffMs } from "./nfl-schedule";

// Sleeper's /state/nfl season_start_date for 2026: Wednesday, September 9.
const START = "2026-09-09";

describe("weekKickoffMs", () => {
  it("is Thursday 8:15 PM EDT in early season", () => {
    expect(new Date(weekKickoffMs(START, 1)).toISOString()).toBe("2026-09-11T00:15:00.000Z");
    expect(new Date(weekKickoffMs(START, 5)).toISOString()).toBe("2026-10-09T00:15:00.000Z");
  });

  it("stays 8:15 PM local after the November clock change", () => {
    // Week 9 Thursday is Nov 5, 2026 — EST, UTC-5.
    expect(new Date(weekKickoffMs(START, 9)).toISOString()).toBe("2026-11-06T01:15:00.000Z");
  });

  it("returns NaN for a malformed start date", () => {
    expect(weekKickoffMs("not a date", 1)).toBeNaN();
  });
});

describe("deriveWeekStatus", () => {
  const sunday = Date.parse("2026-10-04T18:00:00Z"); // week 4 Sunday

  it("treats Sleeper's scored legs as final", () => {
    expect(deriveWeekStatus({ week: 3, nowMs: sunday, leagueComplete: false, lastScoredLeg: 3 })).toBe("FINAL");
  });

  it("marks the week being played as in progress and later weeks as scheduled", () => {
    const base = { nowMs: sunday, leagueComplete: false, lastScoredLeg: 3, seasonStartDate: START };
    expect(deriveWeekStatus({ ...base, week: 4 })).toBe("IN_PROGRESS");
    expect(deriveWeekStatus({ ...base, week: 5 })).toBe("SCHEDULED");
    expect(deriveWeekStatus({ ...base, week: 17 })).toBe("SCHEDULED");
  });

  it("finalises a week on Tuesday morning even before Sleeper's marker moves", () => {
    const tuesdayCron = Date.parse("2026-10-06T12:00:00Z");
    expect(weekFinalMs(START, 4)).toBeLessThan(tuesdayCron);
    expect(
      deriveWeekStatus({ week: 4, nowMs: tuesdayCron, leagueComplete: false, lastScoredLeg: 3, seasonStartDate: START }),
    ).toBe("FINAL");
  });

  it("calls every week final once the league is complete", () => {
    expect(deriveWeekStatus({ week: 17, nowMs: sunday, leagueComplete: true })).toBe("FINAL");
  });

  it("falls back to Sleeper's current leg without a calendar", () => {
    const base = { nowMs: sunday, leagueComplete: false, currentLeg: 4 };
    expect(deriveWeekStatus({ ...base, week: 3 })).toBe("FINAL");
    expect(deriveWeekStatus({ ...base, week: 4 })).toBe("IN_PROGRESS");
    expect(deriveWeekStatus({ ...base, week: 5 })).toBe("SCHEDULED");
  });

  it("never calls a week final on no evidence", () => {
    expect(deriveWeekStatus({ week: 1, nowMs: sunday, leagueComplete: false })).toBe("SCHEDULED");
  });
});

describe("nextKickoff", () => {
  it("finds the next Thursday kickoff", () => {
    const next = nextKickoff(START, Date.parse("2026-10-04T18:00:00Z"), 17);
    expect(next?.week).toBe(5);
    expect(new Date(next!.kickoffMs).toISOString()).toBe("2026-10-09T00:15:00.000Z");
  });

  it("returns null once the last week has kicked off", () => {
    expect(nextKickoff(START, Date.parse("2027-01-20T00:00:00Z"), 17)).toBeNull();
  });
});
