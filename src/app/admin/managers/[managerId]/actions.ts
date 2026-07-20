"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const schema = z.object({
  managerId: z.string().min(1),
  photoUrl: z.string().trim().url().optional().or(z.literal("")),
  nickname: z.string().trim().max(120).optional().or(z.literal("")),
  nicknameOrigin: z.string().trim().max(1000).optional().or(z.literal("")),
  signatureMove: z.string().trim().max(300).optional().or(z.literal("")),
  bio: z.string().trim().max(1000).optional().or(z.literal("")),
  noRoast: z.string().optional(),
});

export async function saveManagerAction(
  _prev: { message: string | null },
  formData: FormData,
): Promise<{ message: string | null }> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");

  const parsed = schema.safeParse({
    managerId: formData.get("managerId"),
    photoUrl: formData.get("photoUrl") || undefined,
    nickname: formData.get("nickname") || undefined,
    nicknameOrigin: formData.get("nicknameOrigin") || undefined,
    signatureMove: formData.get("signatureMove") || undefined,
    bio: formData.get("bio") || undefined,
    noRoast: formData.get("noRoast") || undefined,
  });
  if (!parsed.success) return { message: "Invalid input." };

  await prisma.manager.update({
    where: { id: parsed.data.managerId },
    data: {
      photoUrl: parsed.data.photoUrl || null,
      nickname: parsed.data.nickname || null,
      nicknameOrigin: parsed.data.nicknameOrigin || null,
      signatureMove: parsed.data.signatureMove || null,
      bio: parsed.data.bio || null,
      noRoast: parsed.data.noRoast === "on",
    },
  });
  revalidatePath(`/managers/${parsed.data.managerId}`);
  revalidatePath(`/admin/managers/${parsed.data.managerId}`);
  return { message: "Saved." };
}
