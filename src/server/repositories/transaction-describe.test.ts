import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { describeTransaction, type TransactionAssetView } from "./transaction-repository";

const asset = (playerName: string, managerName: string): TransactionAssetView => ({
  id: `${playerName}-${managerName}`,
  playerName,
  position: "WR",
  teamName: `${managerName}'s team`,
  managerId: managerName,
  managerName,
  otherAsset: null,
});

describe("describeTransaction", () => {
  it("says who got what when a commissioner moves players between two rosters", () => {
    // Nov 2026, Week 10: read "Shea was awarded Strange and Smith-Njigba, dropping Strange and Smith-Njigba".
    const summary = describeTransaction({
      type: "COMMISSIONER",
      outcome: "SUCCESSFUL",
      added: [asset("Brenton Strange", "Michael Shea"), asset("Jaxon Smith-Njigba", "Patrick McManus")],
      dropped: [asset("Brenton Strange", "Patrick McManus"), asset("Jaxon Smith-Njigba", "Michael Shea")],
    } as Parameters<typeof describeTransaction>[0]);
    expect(summary).toBe("Commissioner move: Michael Shea received Brenton Strange; Patrick McManus received Jaxon Smith-Njigba");
  });

  it("keeps the one-manager wording for an ordinary add/drop", () => {
    const summary = describeTransaction({
      type: "FREE_AGENT",
      outcome: "SUCCESSFUL",
      added: [asset("Tyler Bass", "Anthony Cibilich")],
      dropped: [asset("Chase McLaughlin", "Anthony Cibilich")],
    } as Parameters<typeof describeTransaction>[0]);
    expect(summary).toBe("Anthony Cibilich picked up Tyler Bass, dropping Chase McLaughlin");
  });
});
