"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { PrivacyStatus, SensitivityStatus } from "@/generated/prisma/client";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

function revalidate(): void {
  revalidatePath("/admin/knowledge");
}

const PRIVACY_VALUES = Object.values(PrivacyStatus) as string[];
const SENSITIVITY_VALUES = Object.values(SensitivityStatus) as string[];

export async function approveKnowledgeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.leagueKnowledge.update({ where: { id }, data: { approvalStatus: "APPROVED" } });
  revalidate();
}

export async function rejectKnowledgeAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.leagueKnowledge.update({ where: { id }, data: { approvalStatus: "REJECTED" } });
  revalidate();
}

export async function setPrivacyAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const privacyStatus = String(formData.get("privacyStatus") ?? "");
  if (!id || !PRIVACY_VALUES.includes(privacyStatus)) return;
  await prisma.leagueKnowledge.update({
    where: { id },
    data: { privacyStatus: privacyStatus as PrivacyStatus },
  });
  revalidate();
}

export async function markSensitiveAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const sensitivity = String(formData.get("sensitivity") ?? "");
  if (!id || !SENSITIVITY_VALUES.includes(sensitivity)) return;
  await prisma.leagueKnowledge.update({
    where: { id },
    data: { sensitivity: sensitivity as SensitivityStatus },
  });
  revalidate();
}

const editSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20000),
});

export interface KnowledgeEditState {
  message: string | null;
}

export async function saveKnowledgeAction(
  _prev: KnowledgeEditState,
  formData: FormData,
): Promise<KnowledgeEditState> {
  await requireAdmin();
  const parsed = editSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    body: formData.get("body"),
  });
  if (!parsed.success) return { message: "Title and body are required." };
  await prisma.leagueKnowledge.update({
    where: { id: parsed.data.id },
    data: { title: parsed.data.title, body: parsed.data.body },
  });
  revalidate();
  return { message: "Saved." };
}
