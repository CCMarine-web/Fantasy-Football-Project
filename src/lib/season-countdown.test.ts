import { describe, expect, it } from "vitest";
import { chooseSeasonCountdown, type SeasonCountdownInput } from "./season-countdown";
import { draftDateFor } from "./draft-date";

const START_2026 = "2026-09-09";
const DRAFT_2026 = "2026-09-05T17:00:00-05:00";

const base: SeasonCountdownInput = {
  nowMs: Date.parse("2026-10-04T18:00:00Z"),
  seasonYear: 2026,
  seasonComplete: false,
  drafted: true,
  configuredDraftDate: DRAFT_2026,
  seasonStartDate: START_2026,
  playoffStartWeek: 15,
  championshipWeek: 17,
};

describe("draftDateFor", () => {
  it("returns the configured date only for its own season", () => {
    expect(draftDateFor(2026, DRAFT_2026)).toBe(DRAFT_2026);
    expect(draftDateFor(2027, DRAFT_2026)).toBeNull();
    expect(draftDateFor(2026, null)).toBeNull();
    expect(draftDateFor(2026, "garbage")).toBeNull();
  });
});

describe("chooseSeasonCountdown", () => {
  it("counts down to the draft before it happens", () => {
    const c = chooseSeasonCountdown({ ...base, drafted: false, nowMs: Date.parse("2026-08-01T00:00:00Z") });
    expect(c).toMatchObject({ kind: "draft", isoDate: DRAFT_2026 });
  });

  it("says TBD before the draft when no date is set", () => {
    const c = chooseSeasonCountdown({ ...base, drafted: false, configuredDraftDate: null, nowMs: Date.parse("2026-08-01T00:00:00Z") });
    expect(c).toMatchObject({ kind: "draft-tbd", isoDate: null, tbdMessage: "Draft date TBD" });
  });

  it("counts down to the next kickoff in the regular season", () => {
    const c = chooseSeasonCountdown(base);
    expect(c).toMatchObject({ kind: "kickoff", heading: "Countdown to Week 5 Kickoff", isoDate: "2026-10-09T00:15:00.000Z" });
  });

  it("switches to the championship once the next kickoff is a playoff week", () => {
    // Tuesday after week 14: the next kickoff is week 15, the first playoff week.
    const c = chooseSeasonCountdown({ ...base, nowMs: Date.parse("2026-12-15T12:00:00Z") });
    expect(c?.kind).toBe("championship");
    // Week 17 Thursday is Dec 31, 2026, 8:15 PM EST.
    expect(c?.isoDate).toBe("2027-01-01T01:15:00.000Z");
  });

  it("keeps the championship (now passed) during championship week", () => {
    const now = Date.parse("2027-01-03T18:00:00Z");
    const c = chooseSeasonCountdown({ ...base, nowMs: now });
    expect(c?.kind).toBe("championship");
    expect(Date.parse(c!.isoDate!)).toBeLessThan(now);
  });

  it("turns to next year's draft once the season is complete, TBD when last year's date is still configured", () => {
    const c = chooseSeasonCountdown({ ...base, seasonComplete: true, nowMs: Date.parse("2027-02-01T00:00:00Z") });
    expect(c).toMatchObject({ kind: "draft-tbd", heading: "2027 Draft" });
  });

  it("counts down to next year's draft once it is configured", () => {
    const c = chooseSeasonCountdown({
      ...base,
      seasonComplete: true,
      configuredDraftDate: "2027-09-04T17:00:00-05:00",
      nowMs: Date.parse("2027-02-01T00:00:00Z"),
    });
    expect(c).toMatchObject({ kind: "draft", heading: "Countdown to the 2027 Draft" });
  });

  it("never shows a draft timer that has already run out", () => {
    // Draft day has passed but the draft has not synced yet.
    const c = chooseSeasonCountdown({ ...base, drafted: false, nowMs: Date.parse("2026-09-06T00:00:00Z") });
    expect(c?.kind).toBe("draft-tbd");
  });

  it("shows nothing in season without a calendar", () => {
    expect(chooseSeasonCountdown({ ...base, seasonStartDate: null })).toBeNull();
  });
});
