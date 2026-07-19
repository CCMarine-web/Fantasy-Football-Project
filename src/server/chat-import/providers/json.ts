// JSON parser — real implementation for a simple, self-authored export
// shape: an array of `{ timestamp, sender, text, attachments? }` objects (or
// `{ messages: [...] }`). `attachments` entries may be a bare URL string or
// an object `{ type?, filename?, url? }`.
//
//   [
//     { "timestamp": "2023-09-10T14:32:00Z", "sender": "Alex", "text": "Bold trade" },
//     { "timestamp": "2023-09-11T09:05:00Z", "sender": "Jordan", "text": null,
//       "attachments": ["https://example.com/img.jpg"], "replyTo": "1" }
//   ]

import type { CanonicalParsedMessage, ChatParser, ParsedAttachment, ParseResult } from "../types";
import { inferAttachmentType, ParticipantCollector } from "./shared";

interface JsonAttachmentInput {
  type?: string;
  filename?: string;
  url?: string;
}

interface JsonMessageInput {
  id?: string;
  timestamp?: string;
  sender?: string;
  text?: string | null;
  attachments?: (string | JsonAttachmentInput)[];
  replyTo?: string;
}

const VALID_ATTACHMENT_TYPES = new Set(["image", "video", "audio", "file", "link", "unknown"]);

function toAttachment(entry: string | JsonAttachmentInput): ParsedAttachment {
  if (typeof entry === "string") {
    return { type: inferAttachmentType(entry), url: entry };
  }
  const type = entry.type && VALID_ATTACHMENT_TYPES.has(entry.type) ? (entry.type as ParsedAttachment["type"]) : inferAttachmentType(entry.filename ?? entry.url);
  return { type, filename: entry.filename, url: entry.url };
}

function extractMessageList(raw: unknown): JsonMessageInput[] {
  if (Array.isArray(raw)) return raw as JsonMessageInput[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { messages?: unknown }).messages)) {
    return (raw as { messages: JsonMessageInput[] }).messages;
  }
  throw new Error("JSON parser: expected a top-level array of messages, or an object with a `messages` array.");
}

export const jsonParser: ChatParser = {
  platform: "JSON",

  parse(input: string): ParseResult {
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`JSON parser: input is not valid JSON (${message}).`);
    }

    const list = extractMessageList(raw);
    const messages: CanonicalParsedMessage[] = [];
    const warnings: string[] = [];
    const participants = new ParticipantCollector();

    list.forEach((msg, index) => {
      if (!msg || typeof msg !== "object" || !msg.timestamp || !msg.sender) {
        warnings.push(`Message ${index}: missing required "timestamp" or "sender" field — skipped.`);
        return;
      }

      const timestamp = new Date(msg.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        warnings.push(`Message ${index}: unparseable timestamp "${msg.timestamp}" — skipped.`);
        return;
      }

      const attachments = (msg.attachments ?? []).map(toAttachment);

      messages.push({
        timestamp,
        senderRawIdentifier: msg.sender,
        text: msg.text && msg.text.length > 0 ? msg.text : null,
        attachments,
        sourcePlatform: "JSON",
        rawId: msg.id,
        replyToRawId: msg.replyTo,
      });
      participants.add(msg.sender);
    });

    return { messages, participantIdentifiers: participants.toArray(), warnings };
  },
};
