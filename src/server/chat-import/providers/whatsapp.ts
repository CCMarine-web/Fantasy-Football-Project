// WHATSAPP parser — real implementation for WhatsApp's well-documented "Export
// chat" .txt format. Two well-known line shapes, depending on OS/locale:
//
//   Android: M/D/YY, H:MM AM/PM - Sender: Message text
//   iOS:     [M/D/YY, H:MM:SS AM/PM] Sender: Message text
//
// Notes / known limitations of this best-effort parser:
//   - WhatsApp's date order (M/D vs D/M) depends on the exporting phone's
//     locale. This parser assumes US-style M/D/Y, which is the common case
//     for English-locale exports; a genuinely locale-aware parser would need
//     an explicit hint from the caller.
//   - System/notification lines (e.g. "Alex added Bob", "Messages and calls
//     are end-to-end encrypted") share the same timestamp prefix but have no
//     "Sender: text" delimiter, so they're recorded as warnings and skipped.
//   - "<Media omitted>" and the "<filename> (file attached)" placeholder used
//     by newer WhatsApp exports are both recognized as attachments with a
//     null text body.
//   - Multi-line messages (no timestamp prefix) continue the previous
//     message's text, same as the plain-text parser.

import type { CanonicalParsedMessage, ChatParser, ParsedAttachment, ParseResult } from "../types";
import { inferAttachmentType, ParticipantCollector } from "./shared";

const ANDROID_LINE_RE =
  /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?\s?(?:[APap][Mm])?)\s*-\s*(.+)$/;
const IOS_LINE_RE =
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}:\d{2}\s?[APap][Mm])\]\s*(.+)$/;
const SENDER_TEXT_RE = /^([^:]+):\s?(.*)$/;

const MEDIA_OMITTED_RE = /^<\s*media omitted\s*>$/i;
const FILE_ATTACHED_RE = /^(.+?)\s*\(file attached\)$/i;

function parseWhatsAppDateTime(dateStr: string, timeStr: string): Date | null {
  const dateParts = dateStr.split("/").map((p) => parseInt(p, 10));
  if (dateParts.length !== 3 || dateParts.some((n) => Number.isNaN(n))) return null;
  const [month, day, yearRaw] = dateParts;
  const year = yearRaw < 100 ? (yearRaw < 70 ? 2000 + yearRaw : 1900 + yearRaw) : yearRaw;

  const timeMatch = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([APap][Mm])?$/.exec(timeStr.trim());
  if (!timeMatch) return null;

  let hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);
  const second = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
  const meridiem = timeMatch[4]?.toUpperCase();
  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseBody(text: string): { text: string | null; attachments: ParsedAttachment[] } {
  if (MEDIA_OMITTED_RE.test(text.trim())) {
    return { text: null, attachments: [{ type: "unknown" }] };
  }
  const fileMatch = FILE_ATTACHED_RE.exec(text.trim());
  if (fileMatch) {
    const filename = fileMatch[1].trim();
    return { text: null, attachments: [{ type: inferAttachmentType(filename), filename }] };
  }
  return { text: text.length > 0 ? text : null, attachments: [] };
}

export const whatsAppParser: ChatParser = {
  platform: "WHATSAPP",

  parse(input: string): ParseResult {
    const messages: CanonicalParsedMessage[] = [];
    const warnings: string[] = [];
    const participants = new ParticipantCollector();

    const lines = input.split(/\r\n|\r|\n/);
    let lastMessage: CanonicalParsedMessage | null = null;

    lines.forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const line = rawLine.trimEnd();

      if (line.trim().length === 0) {
        return;
      }

      const iosMatch = IOS_LINE_RE.exec(line);
      const androidMatch = !iosMatch ? ANDROID_LINE_RE.exec(line) : null;
      const match = iosMatch ?? androidMatch;

      if (match) {
        const [, dateStr, timeStr, rest] = match;
        const timestamp = parseWhatsAppDateTime(dateStr, timeStr);

        if (!timestamp) {
          warnings.push(`Line ${lineNumber}: unparseable timestamp "${dateStr}, ${timeStr}" — line skipped.`);
          lastMessage = null;
          return;
        }

        const senderMatch = SENDER_TEXT_RE.exec(rest);
        if (!senderMatch) {
          // No "Sender: text" delimiter — this is a system/notification line
          // (e.g. "Alex added Bob"), not an actual chat message.
          warnings.push(`Line ${lineNumber}: system/notification line (no sender) — skipped: "${rest}"`);
          lastMessage = null;
          return;
        }

        const sender = senderMatch[1].trim();
        if (!sender) {
          warnings.push(`Line ${lineNumber}: missing sender — line skipped.`);
          lastMessage = null;
          return;
        }

        const { text, attachments } = parseBody(senderMatch[2]);

        const message: CanonicalParsedMessage = {
          timestamp,
          senderRawIdentifier: sender,
          text,
          attachments,
          sourcePlatform: "WHATSAPP",
          rawId: String(lineNumber),
        };

        messages.push(message);
        participants.add(sender);
        lastMessage = message;
        return;
      }

      if (lastMessage) {
        lastMessage.text = lastMessage.text ? `${lastMessage.text}\n${line}` : line;
        return;
      }

      warnings.push(`Line ${lineNumber}: unparseable line — skipped: "${line}"`);
    });

    return { messages, participantIdentifiers: participants.toArray(), warnings };
  },
};
