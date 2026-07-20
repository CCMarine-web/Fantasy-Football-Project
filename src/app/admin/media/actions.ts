"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { MediaCategory } from "@/generated/prisma/client";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

function revalidate(): void {
  revalidatePath("/admin/media");
}

const MEDIA_CATEGORY_VALUES = Object.values(MediaCategory) as string[];

export async function approveMediaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.mediaAsset.update({ where: { id }, data: { approvalStatus: "APPROVED" } });
  revalidate();
}

export async function rejectMediaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Rejecting also unpublishes — a rejected asset must never stay public.
  await prisma.mediaAsset.update({
    where: { id },
    data: { approvalStatus: "REJECTED", isPublished: false },
  });
  revalidate();
}

export async function togglePublishMediaAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const publish = String(formData.get("publish") ?? "") === "true";
  if (!id) return;
  await prisma.mediaAsset.update({ where: { id }, data: { isPublished: publish } });
  revalidate();
}

export async function changeCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const category = String(formData.get("category") ?? "");
  if (!id || !MEDIA_CATEGORY_VALUES.includes(category)) return;
  await prisma.mediaAsset.update({
    where: { id },
    data: { category: category as MediaCategory },
  });
  revalidate();
}

/**
 * Set a PROFILE media asset as its linked manager's photo. Also approves +
 * publishes the asset (a chosen profile photo is, by definition, public).
 */
export async function setAsManagerPhotoAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const asset = await prisma.mediaAsset.findUnique({
    where: { id },
    select: { url: true, managerId: true },
  });
  if (!asset?.managerId) return;
  await prisma.$transaction([
    prisma.manager.update({ where: { id: asset.managerId }, data: { photoUrl: asset.url } }),
    prisma.mediaAsset.update({
      where: { id },
      data: { approvalStatus: "APPROVED", isPublished: true },
    }),
  ]);
  revalidatePath("/admin/media");
  revalidatePath(`/managers/${asset.managerId}`);
}
