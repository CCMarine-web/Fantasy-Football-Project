// Receipts repository — the DB-facing half of the "Receipts" feature.
//
// A Receipt is a curated bold take (from an APPROVED, non-sensitive chat
// message) paired with what actually happened + an AI verdict, moderated
// through the same PENDING/APPROVED/REJECTED flow as everything else before it
// shows publicly. Detection/verdict text comes from
// src/server/ai/services/receipt-detection.ts; this module owns persistence.

import { prisma } from "@/lib/db";
import { ApprovalStatus, SensitivityStatus } from "@/generated/prisma/client";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { detectReceipt, generateReceiptVerdict } from "@/server/ai/services/receipt-detection";

export interface ReceiptView {
  id: string;
  takeText: string;
  outcomeText: string | null;
  verdict: string | null;
  isWorstTake: boolean;
  approvalStatus: ApprovalStatus;
  createdAt: Date;
  seasonId: string | null;
  seasonYear: number | null;
  sourceText: string | null;
  managerName: string | null;
  messageTimestamp: Date | null;
}

export interface WorstTakeBySeason {
  seasonId: string;
  seasonYear: number;
  receipt: ReceiptView;
}

function toView(row: {
  id: string;
  takeText: string;
  outcomeText: string | null;
  verdict: string | null;
  isWorstTake: boolean;
  approvalStatus: ApprovalStatus;
  createdAt: Date;
  seasonId: string | null;
  season: { year: number } | null;
  chatMessage:
    | { text: string | null; timestamp: Date; linkedManager: { displayName: string } | null }
    | null;
}): ReceiptView {
  return {
    id: row.id,
    takeText: row.takeText,
    outcomeText: row.outcomeText,
    verdict: row.verdict,
    isWorstTake: row.isWorstTake,
    approvalStatus: row.approvalStatus,
    createdAt: row.createdAt,
    seasonId: row.seasonId,
    seasonYear: row.season?.year ?? null,
    sourceText: row.chatMessage?.text ?? null,
    managerName: row.chatMessage?.linkedManager?.displayName ?? null,
    messageTimestamp: row.chatMessage?.timestamp ?? null,
  };
}

const RECEIPT_INCLUDE = {
  season: { select: { year: true } },
  chatMessage: {
    select: {
      text: true,
      timestamp: true,
      linkedManager: { select: { displayName: true } },
    },
  },
} as const;

/**
 * Scans APPROVED, non-sensitive chat messages that aren't already tied to a
 * Receipt, runs take-detection, and creates a PENDING Receipt for each hit.
 * Season is inferred from the message timestamp's year. Admin-triggered and
 * safe to re-run — the `receipts: { none: {} }` filter prevents re-flagging a
 * message that already produced a receipt. Returns the number created.
 */
export async function scanMessagesForReceipts(): Promise<number> {
  const safeguards = await getContentSafeguards();

  const candidates = await prisma.chatMessage.findMany({
    where: {
      approvalStatus: ApprovalStatus.APPROVED,
      sensitivityStatus: SensitivityStatus.NONE,
      deletedAt: null,
      text: { not: null },
      receipts: { none: {} },
    },
    select: { id: true, text: true, timestamp: true },
    orderBy: { timestamp: "asc" },
  });

  // Cache year -> seasonId so we hit Season at most once per distinct year.
  const seasonIdByYear = new Map<number, string | null>();
  async function resolveSeasonId(year: number): Promise<string | null> {
    if (seasonIdByYear.has(year)) return seasonIdByYear.get(year) ?? null;
    const season = await prisma.season.findFirst({ where: { year }, select: { id: true } });
    const id = season?.id ?? null;
    seasonIdByYear.set(year, id);
    return id;
  }

  let created = 0;
  for (const msg of candidates) {
    if (!msg.text) continue;
    const detection = await detectReceipt(msg.text, safeguards);
    if (!detection.isTake) continue;

    const seasonId = await resolveSeasonId(msg.timestamp.getUTCFullYear());
    await prisma.receipt.create({
      data: {
        chatMessageId: msg.id,
        seasonId,
        takeText: detection.takeSummary,
        approvalStatus: ApprovalStatus.PENDING,
      },
    });
    created += 1;
  }

  return created;
}

export async function listReceipts({ approvedOnly }: { approvedOnly?: boolean } = {}): Promise<ReceiptView[]> {
  const rows = await prisma.receipt.findMany({
    where: approvedOnly ? { approvalStatus: ApprovalStatus.APPROVED } : undefined,
    include: RECEIPT_INCLUDE,
    orderBy: [{ isWorstTake: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toView);
}

export async function approveReceipt(id: string): Promise<void> {
  await prisma.receipt.update({
    where: { id },
    data: { approvalStatus: ApprovalStatus.APPROVED },
  });
}

export async function rejectReceipt(id: string): Promise<void> {
  await prisma.receipt.update({
    where: { id },
    data: { approvalStatus: ApprovalStatus.REJECTED, isWorstTake: false },
  });
}

/**
 * Marks one receipt as the season's "Worst Take of the Year", clearing the
 * flag from any other receipt in that season (at most one per season).
 */
export async function setWorstTake(seasonId: string, receiptId: string): Promise<void> {
  await prisma.$transaction([
    prisma.receipt.updateMany({
      where: { seasonId, isWorstTake: true, NOT: { id: receiptId } },
      data: { isWorstTake: false },
    }),
    prisma.receipt.update({
      where: { id: receiptId },
      data: { isWorstTake: true },
    }),
  ]);
}

/**
 * Optionally sets a new outcome and (re)generates the AI verdict pairing the
 * take with that outcome. If no outcome text is supplied it uses whatever is
 * already stored; with nothing to judge against, it clears the verdict.
 */
export async function updateReceiptOutcomeAndVerdict(
  id: string,
  outcomeText?: string,
): Promise<void> {
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    select: { takeText: true, outcomeText: true },
  });
  if (!receipt) return;

  const outcome = (outcomeText ?? receipt.outcomeText ?? "").trim();
  if (!outcome) {
    await prisma.receipt.update({
      where: { id },
      data: { outcomeText: outcomeText ?? receipt.outcomeText ?? null, verdict: null },
    });
    return;
  }

  const safeguards = await getContentSafeguards();
  const verdict = await generateReceiptVerdict(receipt.takeText, outcome, safeguards);
  await prisma.receipt.update({
    where: { id },
    data: { outcomeText: outcome, verdict },
  });
}

/** The isWorstTake receipt for each season, most-recent season first. */
export async function getWorstTakeBySeason(): Promise<WorstTakeBySeason[]> {
  const rows = await prisma.receipt.findMany({
    where: { isWorstTake: true, approvalStatus: ApprovalStatus.APPROVED, seasonId: { not: null } },
    include: RECEIPT_INCLUDE,
  });
  return rows
    .filter((r): r is typeof r & { seasonId: string; season: { year: number } } =>
      r.seasonId !== null && r.season !== null,
    )
    .map((r) => ({ seasonId: r.seasonId, seasonYear: r.season.year, receipt: toView(r) }))
    .sort((a, b) => b.seasonYear - a.seasonYear);
}
