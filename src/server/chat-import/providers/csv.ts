// CSV parser — real implementation for a simple, self-authored export shape:
// a header row of `timestamp,sender,text` (an optional `attachments` column
// holds `|`-separated URLs). No CSV dependency needed — this is a small
// manual row parser that only needs to handle quoted fields (RFC 4180-style
// double-quote escaping), since the shape is deliberately simple.
//
//   timestamp,sender,text,attachments
//   2023-09-10T14:32:00,Alex,"Bold trade, we'll see",
//   2023-09-11T09:05:00,Jordan,"Check this out",https://example.com/img.jpg

import type { CanonicalParsedMessage, ChatParser, ParsedAttachment, ParseResult } from "../types";
import { inferAttachmentType, ParticipantCollector } from "./shared";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export const csvParser: ChatParser = {
  platform: "CSV",

  parse(input: string): ParseResult {
    const messages: CanonicalParsedMessage[] = [];
    const warnings: string[] = [];
    const participants = new ParticipantCollector();

    const lines = input.split(/\r\n|\r|\n/).filter((line) => line.length > 0);
    if (lines.length === 0) {
      return { messages, participantIdentifiers: [], warnings: ["CSV input is empty."] };
    }

    const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const timestampIdx = header.indexOf("timestamp");
    const senderIdx = header.indexOf("sender");
    const textIdx = header.indexOf("text");
    const attachmentsIdx = header.indexOf("attachments");

    if (timestampIdx === -1 || senderIdx === -1 || textIdx === -1) {
      throw new Error('CSV parser: header row must include "timestamp", "sender", and "text" columns.');
    }

    for (let i = 1; i < lines.length; i++) {
      const lineNumber = i + 1;
      const fields = parseCsvLine(lines[i]);
      const timestampStr = fields[timestampIdx]?.trim();
      const sender = fields[senderIdx]?.trim();
      const text = fields[textIdx] ?? "";

      if (!timestampStr || !sender) {
        warnings.push(`Row ${lineNumber}: missing timestamp or sender — skipped.`);
        continue;
      }

      const timestamp = new Date(timestampStr);
      if (Number.isNaN(timestamp.getTime())) {
        warnings.push(`Row ${lineNumber}: unparseable timestamp "${timestampStr}" — skipped.`);
        continue;
      }

      const attachments: ParsedAttachment[] =
        attachmentsIdx !== -1 && fields[attachmentsIdx]?.trim()
          ? fields[attachmentsIdx]
              .split("|")
              .map((url) => url.trim())
              .filter((url) => url.length > 0)
              .map((url) => ({ type: inferAttachmentType(url), url }))
          : [];

      messages.push({
        timestamp,
        senderRawIdentifier: sender,
        text: text.length > 0 ? text : null,
        attachments,
        sourcePlatform: "CSV",
        rawId: String(lineNumber),
      });
      participants.add(sender);
    }

    return { messages, participantIdentifiers: participants.toArray(), warnings };
  },
};
