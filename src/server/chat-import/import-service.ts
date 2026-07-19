// Turns one uploaded chat export into ChatImport / ChatParticipant /
// ChatMessage rows. This is the only place raw export content is read in
// full — everything downstream (review UI, AI context retrieval) only ever
// sees individual rows gated by approvalStatus/sensitivityStatus. See
// ./context-retrieval.ts for the one sanctioned read path for AI generation.

import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApprovalStatus, ChatImportStatus, Prisma, SensitivityStatus } from "@/generated/prisma/client";
import type { ChatPlatform } from "@/generated/prisma/client";
import { getParserForPlatform } from "./registry";
import { ChatImportParseError, ChatImportValidationError } from "./errors";
import type { ParseResult } from "./types";

/** Reasonable upper bound for a single chat export upload. */
export const MAX_CHAT_IMPORT_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

const CHAT_PLATFORM_VALUES = ["IMESSAGE", "WHATSAPP", "GROUPME", "DISCORD", "PLAIN_TEXT", "CSV", "JSON"] as const;

const createChatImportInputSchema = z.object({
  uploadedByUserId: z.string().min(1, "uploadedByUserId is required."),
  sourcePlatform: z.enum(CHAT_PLATFORM_VALUES),
  originalFileName: z.string().min(1, "originalFileName is required.").max(1024),
  fileSizeBytes: z
    .number()
    .int()
    .positive("fileSizeBytes must be a positive integer.")
    .max(MAX_CHAT_IMPORT_FILE_SIZE_BYTES, `File exceeds the ${MAX_CHAT_IMPORT_FILE_SIZE_BYTES}-byte limit.`),
  rawContent: z.string().min(1, "rawContent must not be empty."),
});

export interface CreateChatImportInput {
  uploadedByUserId: string;
  sourcePlatform: ChatPlatform;
  originalFileName: string;
  fileSizeBytes: number;
  rawContent: string;
}

export interface CreateChatImportResult {
  chatImportId: string;
  parseResult: ParseResult;
}

/** Strips `undefined` (not valid JSON) so ParsedAttachment[] can be stored as Prisma Json. */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Validates, creates, parses, and persists one chat export upload.
 *
 * Flow: validate input -> create ChatImport (UPLOADED) -> mark PARSING ->
 * run the platform parser -> persist participants + messages in a single
 * transaction -> mark PARSED (or FAILED with errorMessage on any failure).
 */
export async function createChatImport(input: CreateChatImportInput): Promise<CreateChatImportResult> {
  const validated = createChatImportInputSchema.safeParse(input);
  if (!validated.success) {
    throw new ChatImportValidationError(
      `Invalid chat import input: ${validated.error.issues.map((issue) => issue.message).join("; ")}`
    );
  }

  // Defense in depth: trust the actual byte length of the content over a
  // caller-supplied fileSizeBytes value.
  const actualByteSize = Buffer.byteLength(input.rawContent, "utf8");
  if (actualByteSize > MAX_CHAT_IMPORT_FILE_SIZE_BYTES) {
    throw new ChatImportValidationError(
      `rawContent is ${actualByteSize} bytes, exceeding the ${MAX_CHAT_IMPORT_FILE_SIZE_BYTES}-byte limit.`
    );
  }

  const chatImport = await prisma.chatImport.create({
    data: {
      uploadedByUserId: input.uploadedByUserId,
      sourcePlatform: input.sourcePlatform,
      originalFileName: input.originalFileName,
      fileSizeBytes: input.fileSizeBytes,
      status: ChatImportStatus.UPLOADED,
    },
  });

  await prisma.chatImport.update({
    where: { id: chatImport.id },
    data: { status: ChatImportStatus.PARSING },
  });

  let parseResult: ParseResult;
  try {
    const parser = getParserForPlatform(input.sourcePlatform);
    parseResult = await parser.parse(input.rawContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.chatImport.update({
      where: { id: chatImport.id },
      data: { status: ChatImportStatus.FAILED, errorMessage: message },
    });
    throw new ChatImportParseError(`Failed to parse chat import ${chatImport.id}: ${message}`, err);
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        const participantIdByRawIdentifier = new Map<string, string>();
        for (const rawIdentifier of parseResult.participantIdentifiers) {
          const participant = await tx.chatParticipant.create({
            data: { chatImportId: chatImport.id, rawIdentifier },
          });
          participantIdByRawIdentifier.set(rawIdentifier, participant.id);
        }

        // Resolved as messages are created, in parse order — this correctly
        // resolves replies to earlier messages (the normal case for
        // chronological chat exports). A reply referencing a rawId that
        // hasn't been created yet (or doesn't exist) is left unlinked.
        const messageIdByRawId = new Map<string, string>();

        for (const message of parseResult.messages) {
          const participantId = participantIdByRawIdentifier.get(message.senderRawIdentifier);
          if (!participantId) {
            parseResult.warnings.push(
              `Message at ${message.timestamp.toISOString()} references unknown sender "${message.senderRawIdentifier}" — skipped.`
            );
            continue;
          }

          const replyToMessageId = message.replyToRawId
            ? messageIdByRawId.get(message.replyToRawId)
            : undefined;

          const created = await tx.chatMessage.create({
            data: {
              chatImportId: chatImport.id,
              participantId,
              timestamp: message.timestamp,
              text: message.text,
              hasAttachment: message.attachments.length > 0,
              attachmentsMeta: message.attachments.length > 0 ? toJsonValue(message.attachments) : undefined,
              replyToMessageId: replyToMessageId ?? null,
              sourcePlatform: message.sourcePlatform,
              approvalStatus: ApprovalStatus.PENDING,
              sensitivityStatus: SensitivityStatus.NONE,
            },
          });

          if (message.rawId) {
            messageIdByRawId.set(message.rawId, created.id);
          }
        }

        await tx.chatImport.update({
          where: { id: chatImport.id },
          data: {
            status: ChatImportStatus.PARSED,
            messageCount: parseResult.messages.length,
            completedAt: new Date(),
          },
        });
      },
      // Large imports (5 years of history) create many rows sequentially
      // (sequential creates are needed to resolve reply ids as we go), so
      // this needs a generous timeout well past Prisma's default.
      { timeout: 120_000, maxWait: 10_000 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.chatImport.update({
      where: { id: chatImport.id },
      data: { status: ChatImportStatus.FAILED, errorMessage: message },
    });
    throw err;
  }

  return { chatImportId: chatImport.id, parseResult };
}
