"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import {
  createChatImportDeduped,
  setChatIdentityMapping,
} from "@/server/chat-import/backfill-service";

const CHAT_PLATFORM_VALUES = [
  "IMESSAGE",
  "WHATSAPP",
  "GROUPME",
  "DISCORD",
  "PLAIN_TEXT",
  "CSV",
  "JSON",
] as const;

async function requireAdmin(): Promise<string> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN" || !session.user.id) throw new Error("Admins only");
  return session.user.id;
}

export interface ImportActionState {
  ok: boolean;
  message: string | null;
}

const importSchema = z.object({
  sourcePlatform: z.enum(CHAT_PLATFORM_VALUES),
  originalFileName: z.string().trim().min(1).max(1024),
  rawContent: z.string().min(1),
});

export async function runImportAction(
  _prev: ImportActionState,
  formData: FormData,
): Promise<ImportActionState> {
  const uploadedByUserId = await requireAdmin();

  const parsed = importSchema.safeParse({
    sourcePlatform: formData.get("sourcePlatform"),
    originalFileName: formData.get("originalFileName"),
    rawContent: formData.get("rawContent"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Pick a platform, a filename, and paste the export contents." };
  }

  try {
    const result = await createChatImportDeduped({
      uploadedByUserId,
      sourcePlatform: parsed.data.sourcePlatform,
      originalFileName: parsed.data.originalFileName,
      fileSizeBytes: Buffer.byteLength(parsed.data.rawContent, "utf8"),
      rawContent: parsed.data.rawContent,
    });
    revalidatePath("/admin/chat-import");
    return {
      ok: true,
      message:
        `Imported ${result.messagesImported} message(s) from ${result.participantsFound} participant(s) ` +
        `(${result.participantsAutoLinked} auto-linked). ` +
        `Skipped ${result.duplicatesSkipped} duplicate(s).` +
        (result.warnings.length > 0 ? ` ${result.warnings.length} warning(s).` : ""),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Import failed: ${message}` };
  }
}

export async function saveMappingAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const rawIdentifier = String(formData.get("rawIdentifier") ?? "").trim();
  const managerId = String(formData.get("managerId") ?? "").trim();
  if (!rawIdentifier) return;
  await setChatIdentityMapping(rawIdentifier, managerId || null);
  revalidatePath("/admin/chat-import");
}
