// PLAIN_TEXT parser — a simple, line-oriented format used for the initial
// mocked/sample data and as a manual fallback when no platform-native export
// is available. This is a REAL, working implementation (not a stub).
//
// Supported line shapes:
//   2023-09-10 14:32 - Alex: Bold trade, we'll see
//   2023-09-10 14:32:05 - Alex: Bold trade, we'll see
//   [2023-09-10, 14:32] Alex: Bold trade, we'll see
//   [2023-09-10, 14:32:05] Alex: Bold trade, we'll see
//
// A line that doesn't match either shape is treated as a continuation of the
// previous message's text (multi-line messages) if a previous message
// exists; otherwise it's unparseable and recorded as a warning, not a crash.

import type { CanonicalParsedMessage, ChatParser, ParseResult } from "../types";
import { ParticipantCollector } from "./shared";

const DASH_LINE_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*-\s*([^:]+):\s?(.*)$/;
const BRACKET_LINE_RE = /^\[(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2}(?::\d{2})?)\]\s*([^:]+):\s?(.*)$/;

function parseTimestamp(dateStr: string, timeStr: string): Date | null {
  const normalizedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const date = new Date(`${dateStr}T${normalizedTime}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const plainTextParser: ChatParser = {
  platform: "PLAIN_TEXT",

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
        return; // blank lines are just skipped, not a warning
      }

      const match = DASH_LINE_RE.exec(line) ?? BRACKET_LINE_RE.exec(line);

      if (match) {
        const [, dateStr, timeStr, senderRaw, text] = match;
        const timestamp = parseTimestamp(dateStr, timeStr);
        const sender = senderRaw.trim();

        if (!timestamp) {
          warnings.push(`Line ${lineNumber}: unparseable timestamp "${dateStr} ${timeStr}" — line skipped.`);
          lastMessage = null;
          return;
        }
        if (!sender) {
          warnings.push(`Line ${lineNumber}: missing sender — line skipped.`);
          lastMessage = null;
          return;
        }

        const message: CanonicalParsedMessage = {
          timestamp,
          senderRawIdentifier: sender,
          text: text.length > 0 ? text : null,
          attachments: [],
          sourcePlatform: "PLAIN_TEXT",
          rawId: String(lineNumber),
        };

        messages.push(message);
        participants.add(sender);
        lastMessage = message;
        return;
      }

      // No timestamp/sender prefix — continuation of the previous message.
      if (lastMessage) {
        lastMessage.text = lastMessage.text ? `${lastMessage.text}\n${line}` : line;
        return;
      }

      warnings.push(
        `Line ${lineNumber}: unparseable line (no timestamp/sender match, no prior message to continue) — skipped: "${line}"`
      );
    });

    return { messages, participantIdentifiers: participants.toArray(), warnings };
  },
};
