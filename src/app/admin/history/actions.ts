"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { SensitivityStatus } from "@/generated/prisma/client";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

function revalidate(): void {
  revalidatePath("/admin/history");
}

const SENSITIVITY_VALUES = Object.values(SensitivityStatus) as string[];

export async function approveHistoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.leagueHistorySection.update({ where: { id }, data: { approvalStatus: "APPROVED" } });
  revalidate();
}

export async function rejectHistoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.leagueHistorySection.update({ where: { id }, data: { approvalStatus: "REJECTED" } });
  revalidate();
}

const editSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20000),
});

export interface HistoryEditState {
  message: string | null;
}

export async function saveHistoryAction(
  _prev: HistoryEditState,
  formData: FormData,
): Promise<HistoryEditState> {
  await requireAdmin();
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { message: "Title and body are required." };
  await prisma.leagueHistorySection.update({
    where: { id: parsed.data.id },
    data: { title: parsed.data.title, body: parsed.data.body },
  });
  revalidate();
  return { message: "Saved." };
}

export async function markSensitivityAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const sensitivity = String(formData.get("sensitivity") ?? "");
  if (!id || !SENSITIVITY_VALUES.includes(sensitivity)) return;
  await prisma.leagueHistorySection.update({
    where: { id },
    data: { sensitivity: sensitivity as SensitivityStatus },
  });
  revalidate();
}
