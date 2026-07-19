// GROUPME parser — real implementation based on GroupMe's well-documented
// public API message schema (the shape returned by
// GET /groups/:id/messages and by common GroupMe export tools):
//
//   {
//     "id": "123456789",
//     "created_at": 1382479791,           // unix seconds
//     "name": "Alex",                      // sender display name
//     "text": "Bold trade, we'll see",
//     "system": false,
//     "attachments": [
//       { "type": "image", "url": "https://i.groupme.com/..." },
//       { "type": "reply", "reply_id": "123400000" }
//     ]
//   }
//
// Accepts either a bare JSON array of messages or `{ "messages": [...] }`.
// System messages (system: true, e.g. "X added Y to the group") have no
// real chat content and are skipped with a warning.

import type { CanonicalParsedMessage, ChatParser, ParsedAttachment, ParseResult } from "../types";
import { ParticipantCollector } from "./shared";

interface GroupMeAttachment {
  type?: string;
  url?: string;
  name?: string;
  reply_id?: string;
}

interface GroupMeMessage {
  id?: string;
  created_at?: number;
  name?: string;
  text?: string | null;
  system?: boolean;
  attachments?: GroupMeAttachment[];
}

function mapAttachmentType(type: string | undefined): ParsedAttachment["type"] {
  switch (type) {
    case "image":
      return "image";
    case "video":
      return "video";
    case "audio":
      return "audio";
    case "linked_image":
      return "image";
    default:
      return "unknown";
  }
}

function extractMessageList(raw: unknown): GroupMeMessage[] {
  if (Array.isArray(raw)) return raw as GroupMeMessage[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { messages?: unknown }).messages)) {
    return (raw as { messages: GroupMeMessage[] }).messages;
  }
  throw new Error("GroupMe parser: expected a JSON array of messages, or an object with a `messages` array.");
}

export const groupMeParser: ChatParser = {
  platform: "GROUPME",

  parse(input: string): ParseResult {
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`GroupMe parser: input is not valid JSON (${message}).`);
    }

    const list = extractMessageList(raw);
    const messages: CanonicalParsedMessage[] = [];
    const warnings: string[] = [];
    const participants = new ParticipantCollector();

    list.forEach((msg, index) => {
      if (!msg || typeof msg !== "object") {
        warnings.push(`Message ${index}: not an object — skipped.`);
        return;
      }
      if (msg.system) {
        warnings.push(`Message ${index}: system message — skipped.`);
        return;
      }
      if (typeof msg.created_at !== "number" || !msg.name) {
        warnings.push(`Message ${index}: missing "created_at" or "name" — skipped.`);
        return;
      }

      const rawAttachments = msg.attachments ?? [];
      const replyAttachment = rawAttachments.find((a) => a.type === "reply");
      const attachments: ParsedAttachment[] = rawAttachments
        .filter((a) => a.type !== "reply" && a.type !== "mentions")
        .map((a) => ({ type: mapAttachmentType(a.type), url: a.url, filename: a.name }));

      messages.push({
        timestamp: new Date(msg.created_at * 1000),
        senderRawIdentifier: msg.name,
        text: msg.text && msg.text.length > 0 ? msg.text : null,
        attachments,
        sourcePlatform: "GROUPME",
        rawId: msg.id,
        replyToRawId: replyAttachment?.reply_id,
      });
      participants.add(msg.name);
    });

    return { messages, participantIdentifiers: participants.toArray(), warnings };
  },
};
