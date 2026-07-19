import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { ManagerKey } from "./types";

function newId(): string {
  return crypto.randomUUID();
}

export interface ChatSeedInput {
  prisma: PrismaClient;
  adminUserId: string;
  managerIdByKey: Record<ManagerKey, string>;
}

/** A small taste of the future chat-lore feature — not the focus of this seed. */
export async function seedChatSample(input: ChatSeedInput): Promise<void> {
  const { prisma, adminUserId, managerIdByKey } = input;

  const chatImport = await prisma.chatImport.create({
    data: {
      uploadedByUserId: adminUserId,
      sourcePlatform: "PLAIN_TEXT",
      originalFileName: "gmffl-groupchat-sample-2024.txt",
      fileSizeBytes: 4096,
      status: "PARSED",
      messageCount: 9,
      completedAt: new Date(),
    },
  });

  const participants = [
    { raw: "Marcus", key: "marcus" as ManagerKey },
    { raw: "Kevin", key: "kevin" as ManagerKey },
    { raw: "Sofia", key: "sofia" as ManagerKey },
    { raw: "Priya", key: "priya" as ManagerKey },
  ];

  const participantIdByRaw: Record<string, string> = {};
  for (const p of participants) {
    const participant = await prisma.chatParticipant.create({
      data: {
        chatImportId: chatImport.id,
        rawIdentifier: p.raw,
        linkedManagerId: managerIdByKey[p.key],
      },
    });
    participantIdByRaw[p.raw] = participant.id;
  }

  const baseTime = new Date("2024-10-08T21:00:00Z").getTime();
  const messages: {
    sender: string;
    text: string;
    approvalStatus: "APPROVED" | "PENDING";
    tags?: string[];
  }[] = [
    { sender: "Marcus", text: "bury your kicker, Kevin", approvalStatus: "APPROVED", tags: ["joke"] },
    { sender: "Kevin", text: "this is a transition year and you wouldn't understand", approvalStatus: "APPROVED", tags: ["joke"] },
    { sender: "Sofia", text: "gentlemen. i will be taking my talents to a third ring.", approvalStatus: "APPROVED", tags: ["prediction"] },
    { sender: "Priya", text: "the spreadsheet doesn't lie. you lie. the spreadsheet just reports it.", approvalStatus: "APPROVED", tags: ["quote"] },
    { sender: "Marcus", text: "priya i will be muting this chat", approvalStatus: "APPROVED" },
    { sender: "Kevin", text: "can we talk about the waiver wire instead of my feelings", approvalStatus: "APPROVED", tags: ["joke"] },
    { sender: "Sofia", text: "i already claimed the guy you wanted, kevin", approvalStatus: "APPROVED", tags: ["receipt"] },
    { sender: "Priya", text: "called it in week 1. screenshot attached.", approvalStatus: "PENDING", tags: ["receipt", "prediction"] },
    { sender: "Marcus", text: "somebody stop sofia. anybody. please.", approvalStatus: "APPROVED", tags: ["joke"] },
  ];

  let previousId: string | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    const messageData: Prisma.ChatMessageUncheckedCreateInput = {
      chatImportId: chatImport.id,
      participantId: participantIdByRaw[m.sender]!,
      timestamp: new Date(baseTime + i * 60_000),
      text: m.text,
      sourcePlatform: "PLAIN_TEXT",
      approvalStatus: m.approvalStatus,
      sensitivityStatus: "NONE",
      linkedManagerId: participants.find((p) => p.raw === m.sender)?.key
        ? managerIdByKey[participants.find((p) => p.raw === m.sender)!.key]
        : null,
      replyToMessageId: i === 4 ? previousId : null,
    };
    const message = await prisma.chatMessage.create({ data: messageData });
    if (m.tags) {
      await prisma.chatTag.createMany({
        data: m.tags.map((tag) => ({ id: newId(), messageId: message.id, tag })),
      });
    }
    previousId = message.id;
  }
}
