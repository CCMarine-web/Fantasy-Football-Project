"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { upsertPunishment, deletePunishment } from "@/server/repositories/punishment-repository";

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  managerId: z.string().optional(),
  description: z.string().trim().min(1).max(2000),
  photoUrl: z.string().trim().url().optional().or(z.literal("")),
});

async function requireAdmin() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

export async function savePunishmentAction(
  _prev: { message: string | null },
  formData: FormData,
): Promise<{ message: string | null }> {
  await requireAdmin();
  const parsed = schema.safeParse({
    year: formData.get("year"),
    managerId: formData.get("managerId") || undefined,
    description: formData.get("description"),
    photoUrl: formData.get("photoUrl") || undefined,
  });
  if (!parsed.success) return { message: "Please fill in a valid year and description." };

  await upsertPunishment({
    year: parsed.data.year,
    managerId: parsed.data.managerId || null,
    description: parsed.data.description,
    photoUrl: parsed.data.photoUrl || null,
  });
  revalidatePath("/hall-of-shame");
  revalidatePath("/admin/punishments");
  return { message: `Saved punishment for ${parsed.data.year}.` };
}

export async function deletePunishmentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const year = Number(formData.get("year"));
  if (Number.isFinite(year)) {
    await deletePunishment(year);
    revalidatePath("/hall-of-shame");
    revalidatePath("/admin/punishments");
  }
}
