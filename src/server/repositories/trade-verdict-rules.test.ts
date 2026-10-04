import { describe, expect, it, vi } from "vitest";

// The repository module imports the database client; these rules never touch it.
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { resolveVerdict, tradeVerdictKey } from "./trade-tribunal-repository";

const ALICE = "manager-alice";
const BOB = "manager-bob";

describe("trade verdict rules", () => {
  it("keys provisional and final verdicts differently, on the winner only", () => {
    const prov = tradeVerdictKey({ winnerManagerId: ALICE, provisional: true });
    expect(prov.startsWith("prov:")).toBe(true);
    expect(tradeVerdictKey({ winnerManagerId: ALICE, provisional: false }).startsWith("final:")).toBe(true);
    expect(tradeVerdictKey({ winnerManagerId: BOB, provisional: true })).not.toBe(prov);
    // Same winner, same key: a few points of movement does not rewrite the verdict.
    expect(tradeVerdictKey({ winnerManagerId: ALICE, provisional: true })).toBe(prov);
  });

  it("shows a provisional verdict while its winner still leads", () => {
    const saved = { text: "Alice is winning so far.", inputHash: tradeVerdictKey({ winnerManagerId: ALICE, provisional: true }) };
    expect(resolveVerdict(saved, ALICE, true)).toEqual({ verdict: saved.text, verdictStatus: "PROVISIONAL" });
  });

  it("hides a provisional verdict once the winner flips", () => {
    const saved = { text: "Alice is winning so far.", inputHash: tradeVerdictKey({ winnerManagerId: ALICE, provisional: true }) };
    expect(resolveVerdict(saved, BOB, true)).toEqual({ verdict: null, verdictStatus: "PENDING" });
  });

  it("keeps a provisional verdict after the championship until it is finalised", () => {
    const saved = { text: "Alice is winning so far.", inputHash: tradeVerdictKey({ winnerManagerId: ALICE, provisional: true }) };
    expect(resolveVerdict(saved, ALICE, false)).toEqual({ verdict: saved.text, verdictStatus: "AWAITING_FINAL" });
  });

  it("treats a final verdict as final", () => {
    const saved = { text: "Alice won it.", inputHash: tradeVerdictKey({ winnerManagerId: ALICE, provisional: false }) };
    expect(resolveVerdict(saved, ALICE, false)).toEqual({ verdict: saved.text, verdictStatus: "FINAL" });
  });

  it("holds back a verdict written before this scheme until it is re-keyed or rewritten", () => {
    // Unkeyed verdicts were written against the old trade-week window; the
    // migration re-keys the ones that are still accurate.
    expect(resolveVerdict({ text: "Old ruling.", inputHash: "9f2c1a" }, ALICE, false)).toEqual({ verdict: null, verdictStatus: "PENDING" });
  });

  it("reports a missing verdict as pending", () => {
    expect(resolveVerdict(undefined, ALICE, true)).toEqual({ verdict: null, verdictStatus: "PENDING" });
  });
});
