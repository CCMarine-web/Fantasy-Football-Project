"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { hidePublicMessage, restorePublicMessage } from "@/server/chat/public-chat";

/**
 * Moderation actions for the PUBLIC chat page.
 *
 * Both are admin-gated. Hiding is a soft delete, so a bad call is reversible
 * and the record of what was removed (and by whom) survives.
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

async function requireAdminEmail(): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
  return session.user.email ?? "admin";
}

export async function hideChatMessageAction(formData: FormData): Promise<void> {
  const email = await requireAdminEmail();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  const reason =
    String(formData.get("reason") ?? "")
      .trim()
      .slice(0, 200) || "admin action";
  await hidePublicMessage(parsed.data.id, email, reason);
  revalidatePath("/admin/chat");
  revalidatePath("/chat");
}

export async function restoreChatMessageAction(formData: FormData): Promise<void> {
  await requireAdminEmail();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  await restorePublicMessage(parsed.data.id);
  revalidatePath("/admin/chat");
  revalidatePath("/chat");
}
