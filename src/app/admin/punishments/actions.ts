"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { upsertPunishment, deletePunishment } from "@/server/repositories/punishment-repository";

/**
 * `photoUrl` accepts an absolute URL OR a site-relative path.
 *
 * It used to be `z.string().url()`, which rejected every imported punishment
 * photograph: they are stored as "/punishments/punishment-<hash>.webp" and
 * served from /public. The form silently refused to save and the gallery stayed
 * empty. A relative path must start with a single "/" — "//evil.example" is a
 * protocol-relative URL to another host, not a local file.
 */
const photoUrl = z
  .string()
  .trim()
  .refine(
    (value) =>
      value === "" ||
      /^https?:\/\/\S+$/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("//")),
    { message: "Must be an https URL or a site path beginning with /" },
  );

const schema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  managerId: z.string().optional(),
  description: z.string().trim().min(1).max(2000),
  photoUrl: photoUrl.optional(),
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
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    return {
      message: issue
        ? `Could not save: ${issue}`
        : "Please fill in a valid year and description.",
    };
  }

  const chosenPhoto = parsed.data.photoUrl || null;
  await upsertPunishment({
    year: parsed.data.year,
    managerId: parsed.data.managerId || null,
    description: parsed.data.description,
    photoUrl: chosenPhoto,
  });

  /*
   * Attaching an imported photograph to a season is the deliberate act of
   * publishing it, so the media row is approved and published to match. Without
   * this the Hall of Shame would reference an asset the media review page still
   * lists as pending — two records disagreeing about whether it is public.
   */
  if (chosenPhoto) {
    await prisma.mediaAsset.updateMany({
      where: { url: chosenPhoto, category: "PUNISHMENT" },
      data: {
        approvalStatus: "APPROVED",
        isPublished: true,
        managerId: parsed.data.managerId || null,
      },
    });
  }

  revalidatePath("/hall-of-shame");
  revalidatePath("/admin/punishments");
  revalidatePath("/admin/media");
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
