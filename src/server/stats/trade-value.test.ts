import { describe, expect, it } from "vitest";
import {
  buildPositionContext,
  consolidationCredit,
  gradeLopsidedness,
  valuePlayer,
  valuateTrade,
  type PlayerWindow,
  type ValuedSide,
} from "./trade-value";

function window(part: Partial<PlayerWindow>): PlayerWindow {
  return {
    playerId: "p",
    name: "Player",
    position: "RB",
    gamesPlayed: 10,
    points: 150,
    playoffPoints: 0,
    playoffGames: 0,
    weeksRemaining: 10,
    ...part,
  };
}

describe("buildPositionContext", () => {
  it("puts the replacement line just past the startable pool", () => {
    // 10 teams starting 1 QB: the 11th-best QB is what you could have for free.
    const ppgs = Array.from({ length: 24 }, (_, i) => 30 - i);
    const ctx = buildPositionContext("QB", ppgs, 10);
    expect(ctx.replacementPpg).toBe(30 - 10); // index 10 = 11th best
    expect(ctx.sampleSize).toBe(24);
  });

  it("pushes flex-eligible positions deeper than their own slots", () => {
    const ppgs = Array.from({ length: 40 }, (_, i) => 25 - i * 0.4);
    const rb = buildPositionContext("RB", ppgs, 10);
    const qb = buildPositionContext("QB", ppgs, 10);
    // RB starts 2 plus a third of the flex, so its replacement sits lower.
    expect(rb.replacementPpg).toBeLessThan(qb.replacementPpg);
  });

  it("rates a position with a steep drop-off as scarcer", () => {
    const steep = [40, 38, 36, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1];
    const flat = Array.from({ length: 15 }, () => 15);
    expect(buildPositionContext("TE", steep, 10).scarcity).toBeGreaterThan(
      buildPositionContext("TE", flat, 10).scarcity,
    );
  });

  it("never returns a scarcity outside its band", () => {
    const cliff = [100, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const ctx = buildPositionContext("TE", cliff, 10);
    expect(ctx.scarcity).toBeGreaterThanOrEqual(1);
    expect(ctx.scarcity).toBeLessThanOrEqual(2.5);
  });

  it("handles an empty position without dividing by zero", () => {
    const ctx = buildPositionContext("K", [], 10);
    expect(ctx.replacementPpg).toBe(0);
    expect(ctx.scarcity).toBe(1);
  });
});

describe("valuePlayer", () => {
  const rbContext = { position: "RB", replacementPpg: 10, scarcity: 1.5, sampleSize: 40 };

  it("values only production above the replacement line", () => {
    const v = valuePlayer(window({ points: 150, gamesPlayed: 10 }), rbContext, 80);
    expect(v.pointsPerGame).toBe(15);
    expect(v.ppgAboveReplacement).toBe(5);
    expect(v.pointsAboveReplacement).toBe(50);
    expect(v.value).toBe(75); // 50 * 1.5
  });

  it("gives a replacement-level player no value at all", () => {
    const v = valuePlayer(window({ points: 100, gamesPlayed: 10 }), rbContext, 50);
    expect(v.pointsAboveReplacement).toBe(0);
    expect(v.value).toBe(0);
  });

  it("floors a below-replacement player at zero rather than charging for him", () => {
    // He gets benched or dropped; he does not cost his manager points. But the
    // shortfall is still reported so a reader can see how bad it was.
    const v = valuePlayer(window({ points: 50, gamesPlayed: 10 }), rbContext, 10);
    expect(v.value).toBe(0);
    expect(v.pointsAboveReplacement).toBe(-50);
    expect(v.starterUsability).toBe(0);
  });

  it("does not call a trade of two busts lopsided", () => {
    // The whole reason for the floor: without it, the worse bust produced a
    // hundred-point "differential" and the trade read as a fleecing.
    const worse = valuePlayer(window({ points: 20, gamesPlayed: 10 }), rbContext, 2);
    const bad = valuePlayer(window({ points: 80, gamesPlayed: 10 }), rbContext, 15);
    expect(Math.abs(worse.value - bad.value)).toBe(0);
  });

  it("counts availability rather than estimating an injury discount", () => {
    // Hurt after three weeks: banks three games and nothing more.
    const hurt = valuePlayer(window({ points: 60, gamesPlayed: 3, weeksRemaining: 10 }), rbContext, 70);
    const whole = valuePlayer(window({ points: 200, gamesPlayed: 10, weeksRemaining: 10 }), rbContext, 70);
    expect(hurt.availability).toBe(0.3);
    expect(whole.availability).toBe(1);
    expect(hurt.value).toBeLessThan(whole.value);
    // But his per-game rate is still recognised as good.
    expect(hurt.ppgAboveReplacement).toBe(10);
  });

  it("counts postseason production a second time at a reduced weight", () => {
    const quiet = valuePlayer(window({ points: 150, gamesPlayed: 10 }), rbContext, 70);
    const loud = valuePlayer(
      window({ points: 150, gamesPlayed: 10, playoffPoints: 60, playoffGames: 3 }),
      rbContext,
      70,
    );
    expect(loud.value).toBeGreaterThan(quiet.value);
  });

  it("refuses to value a player who never played after the trade", () => {
    const v = valuePlayer(window({ gamesPlayed: 0, points: 0 }), rbContext, null);
    expect(v.value).toBe(0);
    expect(v.note).toMatch(/did not record a game/);
  });

  it("refuses to value against a position with too small a sample", () => {
    const v = valuePlayer(window({ position: "K" }), { position: "K", replacementPpg: 8, scarcity: 1, sampleSize: 2 }, null);
    expect(v.value).toBe(0);
    expect(v.note).toMatch(/replacement level/);
  });

  it("makes a quarterback and a tight end comparable", () => {
    // The QB scores far more raw points but sits barely above a startable QB;
    // the TE scores less but is miles clear of a startable TE. On raw points
    // the QB wins by 90; on value above replacement the TE should win.
    const qbCtx = { position: "QB", replacementPpg: 18, scarcity: 1.2, sampleSize: 30 };
    const teCtx = { position: "TE", replacementPpg: 6, scarcity: 2.0, sampleSize: 30 };
    const qb = valuePlayer(
      window({ position: "QB", points: 200, gamesPlayed: 10 }),
      qbCtx,
      60,
    );
    const te = valuePlayer(
      window({ position: "TE", points: 110, gamesPlayed: 10 }),
      teCtx,
      95,
    );
    expect(qb.pointsPerGame! - te.pointsPerGame!).toBe(9); // raw points favour the QB
    expect(te.value).toBeGreaterThan(qb.value);
  });
});

describe("gradeLopsidedness", () => {
  it("needs both a relative and an absolute gap", () => {
    // A big relative gap between two tiny hauls is not a robbery.
    expect(gradeLopsidedness(10, 5)).toBe("SLIGHT_EDGE");
    // A modest relative gap between two big hauls is not either.
    expect(gradeLopsidedness(30, 300)).toBe("EVEN_DEAL");
  });

  it("grades a genuine fleecing", () => {
    expect(gradeLopsidedness(120, 70)).toBe("HIGHWAY_ROBBERY");
    expect(gradeLopsidedness(50, 60)).toBe("FLEECED");
    expect(gradeLopsidedness(25, 60)).toBe("CLEAR_WINNER");
  });

  it("calls a close trade even", () => {
    expect(gradeLopsidedness(4, 80)).toBe("EVEN_DEAL");
    expect(gradeLopsidedness(0, 80)).toBe("EVEN_DEAL");
  });
});

describe("valuateTrade", () => {
  const side = (managerId: string, value: number): ValuedSide => ({
    managerId,
    managerName: managerId,
    players: [],
    unpricedAssets: [],
    value,
    consolidationCredit: 0,
  });

  it("names the winner and the margin", () => {
    const result = valuateTrade([side("a", 120), side("b", 20)], {
      missingInputs: [],
      playerCount: 2,
      confidentPlayers: 2,
    });
    expect(result.differential).toBe(100);
    expect(result.winnerManagerId).toBe("a");
    expect(result.lopsidedness).toBe("HIGHWAY_ROBBERY");
    expect(result.confidence).toBe("HIGH");
  });

  it("names nobody as winner on an even deal", () => {
    const result = valuateTrade([side("a", 60), side("b", 58)], {
      missingInputs: [],
      playerCount: 2,
      confidentPlayers: 2,
    });
    expect(result.lopsidedness).toBe("EVEN_DEAL");
    expect(result.winnerManagerId).toBeNull();
  });

  it("lowers confidence when an input is missing", () => {
    const result = valuateTrade([side("a", 100), side("b", 20)], {
      missingInputs: ["a 2026 draft pick, which has no market price on record"],
      playerCount: 2,
      confidentPlayers: 2,
    });
    expect(result.confidence).toBe("MEDIUM");
    expect(result.missingInputs).toHaveLength(1);
  });

  it("returns no verdict at all when nothing could be valued", () => {
    const result = valuateTrade([side("a", 0), side("b", 0)], {
      missingInputs: ["no player-level scoring for this season"],
      playerCount: 0,
      confidentPlayers: 0,
    });
    expect(result.confidence).toBe("NONE");
    expect(result.lopsidedness).toBeNull();
    expect(result.differential).toBeNull();
  });

  it("declines to grade a three-way trade rather than guessing", () => {
    const result = valuateTrade([side("a", 50), side("b", 40), side("c", 30)], {
      missingInputs: [],
      playerCount: 3,
      confidentPlayers: 3,
    });
    expect(result.lopsidedness).toBeNull();
    expect(result.differential).toBeNull();
  });
});

describe("consolidationCredit", () => {
  it("credits turning two players into one", () => {
    expect(consolidationCredit(1, 2)).toBe(4);
  });

  it("gives nothing for taking on more bodies", () => {
    expect(consolidationCredit(2, 1)).toBe(0);
    expect(consolidationCredit(1, 1)).toBe(0);
  });

  it("is capped so it can never decide a verdict", () => {
    expect(consolidationCredit(1, 20)).toBe(8);
  });
});
