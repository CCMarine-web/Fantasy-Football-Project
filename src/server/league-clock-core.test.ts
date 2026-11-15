import { describe, expect, it } from "vitest";
import { resolveLeagueClock, type LeagueClockInput } from "./league-clock-core";

const START = "2026-09-09"; // Wednesday opening NFL week 1, 2026

function at(iso: string): number {
  return Date.parse(iso);
}

function input(over: Partial<LeagueClockInput>): LeagueClockInput {
  return {
    nowMs: at("2026-11-14T18:00:00Z"),
    seasonYear: 2026,
    seasonStatus: "IN_PROGRESS",
    regularSeasonWeeks: 14,
    playoffWeekStart: 15,
    lastWeek: 17,
    lastStoredFinalWeek: 9,
    draftPickCount: 170,
    draftIso: "2026-09-05T17:00:00-05:00",
    leagueTimeZone: "America/Chicago",
    sleeperLeague: { status: "in_season", lastScoredLeg: 9, playoffWeekStart: 15 },
    nflState: { season: 2026, seasonType: "regular", leg: 10, seasonStartDate: START },
    fallbackSeasonStartDate: START,
    ...over,
  };
}

describe("resolveLeagueClock", () => {
  it("Saturday of week 10 (the review date): week 9 complete, week 10 in progress", () => {
    const c = resolveLeagueClock(input({}));
    expect(c.phase).toBe("REGULAR_SEASON");
    expect(c.lastCompletedWeek).toBe(9);
    expect(c.currentWeek).toBe(10);
    expect(c.currentWeekState).toBe("IN_PROGRESS");
    expect(c.focus).toBe("SLATE");
    expect(c.focusWeek).toBe(10);
    expect(c.regularWeeksRemaining).toBe(5);
    expect(c.label).toBe("Week 10 · in progress");
  });

  it("Wednesday after MNF: week 10 is final, week 11 is up next and the hub shows results", () => {
    const c = resolveLeagueClock(
      input({ nowMs: at("2026-11-18T15:00:00Z"), lastStoredFinalWeek: 10, sleeperLeague: { status: "in_season", lastScoredLeg: 10 } }),
    );
    expect(c.lastCompletedWeek).toBe(10);
    expect(c.currentWeek).toBe(11);
    expect(c.currentWeekState).toBe("UPCOMING");
    expect(c.focus).toBe("RESULTS");
    expect(c.focusWeek).toBe(10);
  });

  it("calls a week final from the calendar even before Sleeper or the sync catch up, and flags the lag", () => {
    const c = resolveLeagueClock(
      input({ nowMs: at("2026-11-17T11:00:00Z"), lastStoredFinalWeek: 9, sleeperLeague: { status: "in_season", lastScoredLeg: 9 } }),
    );
    expect(c.lastCompletedWeek).toBe(10);
    expect(c.syncBehind).toBe(true);
    // Results that aren't stored yet are never the focus.
    expect(c.focusWeek).toBe(9);
  });

  it("never treats week 17 as current mid-season", () => {
    const c = resolveLeagueClock(input({}));
    expect(c.currentWeek).not.toBe(17);
  });

  it("enters the playoffs at playoff_week_start", () => {
    const c = resolveLeagueClock(
      input({ nowMs: at("2026-12-19T18:00:00Z"), lastStoredFinalWeek: 14, sleeperLeague: { status: "in_season", lastScoredLeg: 14, playoffWeekStart: 15 } }),
    );
    expect(c.phase).toBe("PLAYOFFS");
    expect(c.currentWeek).toBe(15);
    expect(c.regularWeeksRemaining).toBe(0);
  });

  it("is COMPLETE after the title game, then OFFSEASON once the NFL is done too", () => {
    const done = input({
      seasonStatus: "COMPLETE",
      lastStoredFinalWeek: 17,
      sleeperLeague: { status: "complete", lastScoredLeg: 17 },
      nowMs: at("2027-01-05T18:00:00Z"),
      nflState: { season: 2026, seasonType: "post", leg: 18, seasonStartDate: START },
    });
    expect(resolveLeagueClock(done).phase).toBe("COMPLETE");
    expect(resolveLeagueClock(done).currentWeek).toBeNull();
    expect(resolveLeagueClock({ ...done, nowMs: at("2027-04-01T18:00:00Z"), nflState: { season: 2026, seasonType: "off", leg: 0, seasonStartDate: START } }).phase).toBe(
      "OFFSEASON",
    );
  });

  it("PRE_DRAFT before the draft, DRAFT_DAY on the day (league time)", () => {
    const pre = input({
      seasonStatus: "UPCOMING",
      lastStoredFinalWeek: null,
      draftPickCount: 0,
      sleeperLeague: { status: "pre_draft", lastScoredLeg: null },
      nowMs: at("2026-08-20T18:00:00Z"),
      nflState: { season: 2026, seasonType: "pre", leg: 0, seasonStartDate: START },
    });
    const c = resolveLeagueClock(pre);
    expect(c.phase).toBe("PRE_DRAFT");
    expect(c.currentWeek).toBeNull();
    // 2026-09-05 at 11:00 Chicago time: draft is at 17:00 that day.
    expect(resolveLeagueClock({ ...pre, nowMs: at("2026-09-05T16:00:00Z") }).phase).toBe("DRAFT_DAY");
    expect(resolveLeagueClock({ ...pre, sleeperLeague: { status: "drafting" } }).phase).toBe("DRAFT_DAY");
  });

  it("after the draft and before week 1 it is the regular season with week 1 up next", () => {
    const c = resolveLeagueClock(
      input({
        nowMs: at("2026-09-07T18:00:00Z"),
        lastStoredFinalWeek: null,
        sleeperLeague: { status: "in_season", lastScoredLeg: 0 },
      }),
    );
    expect(c.phase).toBe("REGULAR_SEASON");
    expect(c.currentWeek).toBe(1);
    expect(c.currentWeekState).toBe("UPCOMING");
    expect(c.focus).toBe("SLATE");
  });

  it("works without Sleeper, from stored data and the calendar", () => {
    const c = resolveLeagueClock(input({ sleeperLeague: null, nflState: null }));
    expect(c.lastCompletedWeek).toBe(9);
    expect(c.currentWeek).toBe(10);
    expect(c.currentWeekState).toBe("IN_PROGRESS");
  });
});
