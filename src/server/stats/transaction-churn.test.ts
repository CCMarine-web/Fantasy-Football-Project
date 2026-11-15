import { describe, expect, it } from "vitest";
import { collapseChurn, describeChurn, type ChurnMove } from "./transaction-churn";

let t = 0;
function move(id: string, add: string | null, drop: string | null, over: Partial<ChurnMove> = {}): ChurnMove {
  const asset = (p: string) => ({ playerName: p, managerId: "mcm", managerName: "Patrick McManus" });
  return {
    id,
    week: 9,
    type: "FREE_AGENT",
    outcome: "SUCCESSFUL",
    processedAt: new Date(Date.UTC(2026, 10, 7, 0, ++t)),
    added: add ? [asset(add)] : [],
    dropped: drop ? [asset(drop)] : [],
    ...over,
  };
}

describe("collapseChurn", () => {
  it("collapses McManus's six Kendre Miller / Austin Ekeler moves into one row", () => {
    const moves = [
      move("1", "Kendre Miller", "Tyjae Spears"),
      move("2", "Austin Ekeler", "Kendre Miller"),
      move("3", "Kendre Miller", "Austin Ekeler"),
      move("4", "Austin Ekeler", "Kendre Miller"),
      move("5", "Kendre Miller", "Austin Ekeler"),
      move("6", "Wan'Dale Robinson", "Kendre Miller"),
      move("other", "Chad Ryland", null, {
        added: [{ playerName: "Chad Ryland", managerId: "shea", managerName: "Michael Shea" }],
      }),
    ].reverse(); // newest first, as the wire lists them
    const out = collapseChurn(moves);
    expect(out).toHaveLength(2);
    const row = out.find((m) => m.churn);
    expect(row?.id).toBe("6");
    expect(row?.churn).toMatchObject({ moves: 6, swaps: 5, netAdded: ["Wan'Dale Robinson"], netDropped: ["Tyjae Spears"] });
    expect([...(row?.churn?.churnedPlayers ?? [])].sort()).toEqual(["Austin Ekeler", "Kendre Miller"]);
    expect(describeChurn(row!.churn!)).toBe(
      "Patrick McManus swapped Kendre Miller ↔ Austin Ekeler ×5 · net +Wan'Dale Robinson, −Tyjae Spears",
    );
  });

  it("leaves ordinary moves, trades, other weeks and failed claims alone", () => {
    const moves = [
      move("a", "A", "B"),
      move("b", "B", "A", { week: 10 }),
      move("c", "A", "B", { type: "TRADE" }),
      move("d", "A", "B", { outcome: "FAILED" }),
    ];
    expect(collapseChurn(moves).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("needs a player both added and dropped, not just three moves", () => {
    const moves = [move("x", "A", null), move("y", "B", null), move("z", "C", null)];
    expect(collapseChurn(moves).every((m) => !m.churn)).toBe(true);
  });
});
