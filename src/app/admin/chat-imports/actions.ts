"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") throw new Error("Admins only");
}

/**
 * Map an (as-yet unresolved) chat participant to a manager. This:
 *   1. sets ChatParticipant.linkedManagerId for the specific participant,
 *   2. upserts the remembered ChatIdentityMap (rawIdentifier -> managerId) so
 *      future imports auto-link the same handle, and
 *   3. back-fills linkedManagerId on that participant's ChatMessages, so
 *      approved messages are immediately retrievable by manager.
 */
export async function mapParticipantAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const participantId = String(formData.get("participantId") ?? "").trim();
  const managerId = String(formData.get("managerId") ?? "").trim();
  if (!participantId || !managerId) return;

  const participant = await prisma.chatParticipant.findUnique({
    where: { id: participantId },
    select: { id: true, rawIdentifier: true },
  });
  if (!participant) return;

  await prisma.$transaction([
    prisma.chatParticipant.update({
      where: { id: participant.id },
      data: { linkedManagerId: managerId },
    }),
    prisma.chatIdentityMap.upsert({
      where: { rawIdentifier: participant.rawIdentifier },
      update: { managerId },
      create: { rawIdentifier: participant.rawIdentifier, managerId },
    }),
    prisma.chatMessage.updateMany({
      where: { participantId: participant.id },
      data: { linkedManagerId: managerId },
    }),
  ]);

  revalidatePath("/admin/chat-imports");
}
