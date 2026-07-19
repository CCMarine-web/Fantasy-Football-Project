// DISCORD parser — real implementation based on the JSON schema produced by
// DiscordChatExporter, the de-facto standard tool for exporting Discord
// channel history (there's no first-party "export chat" feature in Discord
// itself):
//
//   {
//     "guild": { ... },
//     "channel": { ... },
//     "messages": [
//       {
//         "id": "1234567890",
//         "timestamp": "2023-09-10T14:32:05.123+00:00",
//         "author": { "name": "Alex", "nickname": "Alex", "id": "..." },
//         "content": "Bold trade, we'll see",
//         "attachments": [ { "fileName": "photo.jpg", "url": "https://..." } ],
//         "reference": { "messageId": "1234500000" }
//       }
//     ]
//   }
//
// Accepts either the full exporter document (`{ messages: [...] }`) or a bare
// array of message objects. Uses `nickname` over `name` when present (server
// nickname is the more recognizable identity within one guild).

import type { CanonicalParsedMessage, ChatParser, ParsedAttachment, ParseResult } from "../types";
import { inferAttachmentType, ParticipantCollector } from "./shared";

interface DiscordAuthor {
  name?: string;
  nickname?: string;
}

interface DiscordAttachment {
  fileName?: string;
  url?: string;
}

interface DiscordReference {
  messageId?: string;
}

interface DiscordMessage {
  id?: string;
  timestamp?: string;
  author?: DiscordAuthor;
  content?: string;
  attachments?: DiscordAttachment[];
  reference?: DiscordReference;
}

function extractMessageList(raw: unknown): DiscordMessage[] {
  if (Array.isArray(raw)) return raw as DiscordMessage[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { messages?: unknown }).messages)) {
    return (raw as { messages: DiscordMessage[] }).messages;
  }
  throw new Error(
    "Discord parser: expected a DiscordChatExporter-style JSON document ({ messages: [...] }) or a bare array of messages."
  );
}

export const discordParser: ChatParser = {
  platform: "DISCORD",

  parse(input: string): ParseResult {
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Discord parser: input is not valid JSON (${message}).`);
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
      const sender = msg.author?.nickname || msg.author?.name;
      if (!msg.timestamp || !sender) {
        warnings.push(`Message ${index}: missing "timestamp" or "author.name" — skipped.`);
        return;
      }

      const timestamp = new Date(msg.timestamp);
      if (Number.isNaN(timestamp.getTime())) {
        warnings.push(`Message ${index}: unparseable timestamp "${msg.timestamp}" — skipped.`);
        return;
      }

      const attachments: ParsedAttachment[] = (msg.attachments ?? []).map((a) => ({
        type: inferAttachmentType(a.fileName ?? a.url),
        filename: a.fileName,
        url: a.url,
      }));

      messages.push({
        timestamp,
        senderRawIdentifier: sender,
        text: msg.content && msg.content.length > 0 ? msg.content : null,
        attachments,
        sourcePlatform: "DISCORD",
        rawId: msg.id,
        replyToRawId: msg.reference?.messageId,
      });
      participants.add(sender);
    });

    return { messages, participantIdentifiers: participants.toArray(), warnings };
  },
};
