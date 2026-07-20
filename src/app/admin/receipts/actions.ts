"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  scanMessagesForReceipts,
  approveReceipt,
  rejectReceipt,
  setWorstTake,
  updateReceiptOutcomeAndVerdict,
} from "@/server/repositories/receipts-repository";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

function revalidate(): void {
  revalidatePath("/admin/receipts");
  revalidatePath("/receipts");
}

export interface ScanState {
  message: string | null;
}

export async function scanReceiptsAction(
  _prev: ScanState,
  _formData: FormData,
): Promise<ScanState> {
  await requireAdmin();
  const created = await scanMessagesForReceipts();
  revalidate();
  return {
    message:
      created === 0
        ? "Scan complete — no new bold takes found in approved messages."
        : `Scan complete — flagged ${created} new receipt(s) for review.`,
  };
}

export async function approveReceiptAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await approveReceipt(id);
    revalidate();
  }
}

export async function rejectReceiptAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) {
    await rejectReceipt(id);
    revalidate();
  }
}

export async function setWorstTakeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const seasonId = String(formData.get("seasonId") ?? "");
  if (id && seasonId) {
    await setWorstTake(seasonId, id);
    revalidate();
  }
}

export async function saveOutcomeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const outcomeText = String(formData.get("outcomeText") ?? "").trim();
  if (id) {
    await updateReceiptOutcomeAndVerdict(id, outcomeText || undefined);
    revalidate();
  }
}
