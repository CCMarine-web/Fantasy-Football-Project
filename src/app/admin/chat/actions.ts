"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import {
  deletePublicMessage,
  hidePublicMessage,
  mutePublicMessageAuthor,
  restorePublicMessage,
} from "@/server/chat/public-chat";
import {
  addModerationRule,
  issueChatCode,
  removeModerationRule,
  revokeChatCode,
} from "@/server/chat/identity";

/**
 * Moderation actions for the PUBLIC chat page.
 *
 * Every one is admin-gated. Hiding is a soft delete so a bad call is reversible
 * and the record of what was removed (and by whom) survives; deleting is
 * offered separately, for the messages that should not exist in an audit trail
 * either.
 *
 * Muting keys on the salted author digest already stored against the message —
 * the raw address is never persisted, so there is nothing else to key on and
 * nothing personal to leak.
 */

const idSchema = z.object({ id: z.string().min(1).max(64) });

async function requireAdminEmail(): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
  return session.user.email ?? "admin";
}

function revalidate(): void {
  revalidatePath("/admin/chat");
  revalidatePath("/chat");
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
  revalidate();
}

export async function restoreChatMessageAction(formData: FormData): Promise<void> {
  await requireAdminEmail();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  await restorePublicMessage(parsed.data.id);
  revalidate();
}

export async function deleteChatMessageAction(formData: FormData): Promise<void> {
  await requireAdminEmail();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  await deletePublicMessage(parsed.data.id);
  revalidate();
}

export async function muteChatAuthorAction(formData: FormData): Promise<void> {
  const email = await requireAdminEmail();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;

  // Blank or unparseable means an indefinite mute, which is the safe default
  // for the case an admin reaches for this button.
  const rawHours = String(formData.get("hours") ?? "").trim();
  const hours = rawHours ? Number(rawHours) : null;
  await mutePublicMessageAuthor(
    parsed.data.id,
    email,
    Number.isFinite(hours) && hours && hours > 0 ? hours : null,
    "muted from the moderation screen",
  );
  revalidate();
}

export async function blockChatNameAction(formData: FormData): Promise<void> {
  const email = await requireAdminEmail();
  const value = String(formData.get("value") ?? "")
    .trim()
    .slice(0, 64);
  if (!value) return;
  const reason = String(formData.get("reason") ?? "")
    .trim()
    .slice(0, 200);
  await addModerationRule({
    kind: "BLOCKED_NAME",
    value,
    reason: reason || null,
    createdBy: email,
  });
  revalidate();
}

export async function removeChatRuleAction(formData: FormData): Promise<void> {
  await requireAdminEmail();
  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return;
  await removeModerationRule(parsed.data.id);
  revalidate();
}

export interface ChatCodeState {
  managerName: string | null;
  code: string | null;
  message: string | null;
}

/**
 * Issues a manager's chat code and returns the plaintext ONCE.
 *
 * Only the hash is stored, so this is the only moment the code exists in a form
 * anyone can read. Losing it means issuing a new one, which is the correct
 * trade: a code recoverable from the database is a code an attacker can recover
 * from the database.
 */
export async function issueChatCodeAction(
  _prev: ChatCodeState,
  formData: FormData,
): Promise<ChatCodeState> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return { managerName: null, code: null, message: "Admins only." };
  }

  const managerId = String(formData.get("managerId") ?? "").trim();
  const managerName = String(formData.get("managerName") ?? "").trim() || null;
  if (!managerId) return { managerName: null, code: null, message: "Pick a manager first." };

  if (formData.get("revoke") === "1") {
    await revokeChatCode(managerId);
    revalidate();
    return {
      managerName,
      code: null,
      message: `Revoked. ${managerName ?? "That manager"}'s name is now fully reserved — nobody can post under it.`,
    };
  }

  const code = await issueChatCode(managerId);
  revalidate();
  return {
    managerName,
    code,
    message: `Give this to ${managerName ?? "the manager"} now — it is not stored and cannot be shown again.`,
  };
}
