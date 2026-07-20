// Bulk-backfill wrapper around the chat-import pipeline.
//
// The base createChatImport() (./import-service.ts) is intentionally left
// untouched — it and its test keep working exactly as before. This module
// adds the two things a multi-year, many-overlapping-exports backfill needs:
//
//   1. Remembered manager mapping — a raw handle/phone/number that was linked
//      to a Manager once (ChatIdentityMap) is auto-linked on every future
//      import, so you don't re-map the same 12 people for every yearly export.
//
//   2. Cross-export dedup — the same message often appears in two overlapping
//      exports (e.g. a 2020-2023 dump and a 2023-2024 dump both containing
//      2023). We skip any incoming message whose (timestamp, sender raw
//      identifier, text) already exists from a PRIOR import, and report how
//      many were skipped.
//
// Everything else (validation, the parser registry, row shapes) is reused
// from import-service.ts / registry.ts — no parser is rewritten here.

import { prisma } from "@/lib/db";
import { ApprovalStatus, ChatImportStatus, Prisma, SensitivityStatus } from "@/generated/prisma/client";
import { getParserForPlatform } from "./registry";
import { ChatImportParseError, ChatImportValidationError } from "./errors";
import { MAX_CHAT_IMPORT_FILE_SIZE_BYTES } from "./import-service";
import type { CreateChatImportInput } from "./import-service";
import type { ParseResult } from "./types";

export interface BackfillImportResult {
  chatImportId: string;
  /** Rows actually written (post-dedup). */
  messagesImported: number;
  /** Incoming messages skipped because an identical one already existed. */
  duplicatesSkipped: number;
  /** Distinct participants found in this export. */
  participantsFound: number;
  /** How many participants were auto-linked to a Manager via ChatIdentityMap. */
  participantsAutoLinked: number;
  warnings: string[];
}

export interface ChatIdentityMappingView {
  id: string;
  rawIdentifier: string;
  managerId: string | null;
  managerName: string | null;
  updatedAt: Date;
}

/** Strips `undefined` (not valid JSON) so ParsedAttachment[] can be stored as Prisma Json. */
function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Content key for cross-export dedup. Two messages are considered "the same"
 * if they share a timestamp (to the millisecond), the sender's raw identifier,
 * and their text. This is deliberately simple and cheap — good enough because
 * the same export re-run always produces byte-identical rows, and it never
 * merges two genuinely-distinct messages that happen to share a second.
 */
function contentKey(timestampMs: number, rawIdentifier: string, text: string | null): string {
  return `${timestampMs}|${rawIdentifier}|${text ?? ""}`;
}

/**
 * Like createChatImport(), but applies remembered identity mapping + dedup.
 *
 * Flow: validate -> create ChatImport (PARSING) -> parse -> look up
 * ChatIdentityMap for every participant -> load existing message keys in the
 * incoming time-range -> in one transaction, create participants (pre-linked
 * where a mapping exists) and only the non-duplicate messages -> mark PARSED.
 */
export async function createChatImportDeduped(input: CreateChatImportInput): Promise<BackfillImportResult> {
  // --- validate (mirrors createChatImport's guards; defense in depth) --------
  if (!input.uploadedByUserId?.trim()) {
    throw new ChatImportValidationError("uploadedByUserId is required.");
  }
  if (!input.originalFileName?.trim()) {
    throw new ChatImportValidationError("originalFileName is required.");
  }
  if (!input.rawContent?.trim()) {
    throw new ChatImportValidationError("rawContent must not be empty.");
  }
  const actualByteSize = Buffer.byteLength(input.rawContent, "utf8");
  if (actualByteSize > MAX_CHAT_IMPORT_FILE_SIZE_BYTES) {
    throw new ChatImportValidationError(
      `rawContent is ${actualByteSize} bytes, exceeding the ${MAX_CHAT_IMPORT_FILE_SIZE_BYTES}-byte limit.`,
    );
  }

  const chatImport = await prisma.chatImport.create({
    data: {
      uploadedByUserId: input.uploadedByUserId,
      sourcePlatform: input.sourcePlatform,
      originalFileName: input.originalFileName,
      fileSizeBytes: input.fileSizeBytes,
      status: ChatImportStatus.PARSING,
    },
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

  // --- remembered manager mapping -------------------------------------------
  const identityMaps =
    parseResult.participantIdentifiers.length > 0
      ? await prisma.chatIdentityMap.findMany({
          where: { rawIdentifier: { in: parseResult.participantIdentifiers } },
          select: { rawIdentifier: true, managerId: true },
        })
      : [];
  const managerByRawIdentifier = new Map<string, string>();
  for (const m of identityMaps) {
    if (m.managerId) managerByRawIdentifier.set(m.rawIdentifier, m.managerId);
  }

  // --- load existing keys for dedup, scoped to the incoming time-range -------
  // Scoping by [min, max] timestamp keeps this bounded even against a large
  // historical corpus: we only load rows that could possibly collide.
  const existingKeys = new Set<string>();
  if (parseResult.messages.length > 0) {
    const times = parseResult.messages.map((m) => m.timestamp.getTime());
    const minTs = new Date(Math.min(...times));
    const maxTs = new Date(Math.max(...times));
    const existing = await prisma.chatMessage.findMany({
      where: { timestamp: { gte: minTs, lte: maxTs }, deletedAt: null },
      select: { timestamp: true, text: true, participant: { select: { rawIdentifier: true } } },
    });
    for (const row of existing) {
      existingKeys.add(contentKey(row.timestamp.getTime(), row.participant.rawIdentifier, row.text));
    }
  }

  let duplicatesSkipped = 0;
  let messagesImported = 0;

  try {
    await prisma.$transaction(
      async (tx) => {
        const participantIdByRawIdentifier = new Map<string, string>();
        for (const rawIdentifier of parseResult.participantIdentifiers) {
          const linkedManagerId = managerByRawIdentifier.get(rawIdentifier) ?? null;
          const participant = await tx.chatParticipant.create({
            data: { chatImportId: chatImport.id, rawIdentifier, linkedManagerId },
          });
          participantIdByRawIdentifier.set(rawIdentifier, participant.id);
        }

        const messageIdByRawId = new Map<string, string>();

        for (const message of parseResult.messages) {
          const participantId = participantIdByRawIdentifier.get(message.senderRawIdentifier);
          if (!participantId) {
            parseResult.warnings.push(
              `Message at ${message.timestamp.toISOString()} references unknown sender "${message.senderRawIdentifier}" — skipped.`,
            );
            continue;
          }

          const key = contentKey(message.timestamp.getTime(), message.senderRawIdentifier, message.text);
          if (existingKeys.has(key)) {
            duplicatesSkipped += 1;
            continue;
          }
          // Also guard against duplicates *within* this same export.
          existingKeys.add(key);

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
              // Pre-link the message to the remembered manager, so approved
              // messages are immediately retrievable by manager for AI context.
              linkedManagerId: managerByRawIdentifier.get(message.senderRawIdentifier) ?? null,
            },
          });
          messagesImported += 1;

          if (message.rawId) {
            messageIdByRawId.set(message.rawId, created.id);
          }
        }

        await tx.chatImport.update({
          where: { id: chatImport.id },
          data: {
            status: ChatImportStatus.PARSED,
            messageCount: messagesImported,
            completedAt: new Date(),
          },
        });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.chatImport.update({
      where: { id: chatImport.id },
      data: { status: ChatImportStatus.FAILED, errorMessage: message },
    });
    throw err;
  }

  return {
    chatImportId: chatImport.id,
    messagesImported,
    duplicatesSkipped,
    participantsFound: parseResult.participantIdentifiers.length,
    participantsAutoLinked: managerByRawIdentifier.size,
    warnings: parseResult.warnings,
  };
}

/**
 * Upsert the remembered mapping for a raw identifier AND propagate it to every
 * existing ChatParticipant/ChatMessage row that uses that identifier — so
 * re-mapping (or mapping for the first time after an import) fixes past rows
 * too, not just future imports. Pass managerId = null to clear a mapping.
 */
export async function setChatIdentityMapping(
  rawIdentifier: string,
  managerId: string | null,
): Promise<void> {
  const raw = rawIdentifier.trim();
  if (!raw) throw new ChatImportValidationError("rawIdentifier is required.");

  await prisma.$transaction(async (tx) => {
    await tx.chatIdentityMap.upsert({
      where: { rawIdentifier: raw },
      update: { managerId },
      create: { rawIdentifier: raw, managerId },
    });

    const participants = await tx.chatParticipant.findMany({
      where: { rawIdentifier: raw },
      select: { id: true },
    });
    await tx.chatParticipant.updateMany({
      where: { rawIdentifier: raw },
      data: { linkedManagerId: managerId },
    });

    const participantIds = participants.map((p) => p.id);
    if (participantIds.length > 0) {
      await tx.chatMessage.updateMany({
        where: { participantId: { in: participantIds } },
        data: { linkedManagerId: managerId },
      });
    }
  });
}

export async function listChatIdentityMappings(): Promise<ChatIdentityMappingView[]> {
  const rows = await prisma.chatIdentityMap.findMany({
    include: { manager: { select: { id: true, displayName: true } } },
    orderBy: { rawIdentifier: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    rawIdentifier: r.rawIdentifier,
    managerId: r.managerId,
    managerName: r.manager?.displayName ?? null,
    updatedAt: r.updatedAt,
  }));
}
