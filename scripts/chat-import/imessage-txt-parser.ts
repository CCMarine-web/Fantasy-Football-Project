import type { ParsedMessage, ParseStats, ParseResult } from "./imessage-pdf-parser";
import { normalizePhone } from "./identity-resolver";

/**
 * Parser for the plain-text iMessage export ("Messages - The League.txt").
 * Far cleaner than the PDF layout: messages are delimited by dashed rules and
 * each carries an explicit header. Emits the same ParsedMessage shape as the
 * PDF parser so the importer/report code is shared.
 *
 * Block shape:
 *   ----------------------------------------------------
 *   The League                                  <- conversation name
 *   2023-07-25 16:48:53 from Logan Javier (+15043734088) - Read
 *      | 2023-07-25 17:07:28 to The League - Read           (owner outgoing)
 *      | 2023-07-25 16:49:06 notification                   (system event)
 *   <blank>
 *   <body… may be multiline; may contain a reaction line and/or a media line>
 */

const RE_DELIM = /^-{10,}\s*$/;
const RE_HEADER =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (?:from (.+?) \((\+?[\d\s().-]+)\)|(to) .+?|(notification))(?: - (?:Read|Sent|Delivered))?\s*$/;
const RE_REACTION = /^.+ reacted with .+ on \d{1,2}\/\d{1,2}\/\d{2,4}/;
const RE_MEDIA = /\((Image|Video|Audio|GIF|Attachment|Contact|Location|vCard|Sticker)\)\s*$/i;
// "↩ Replying to Name, 2023-07-27 17:00:56: « quoted preview »" — the quote is
// dropped; the real reply text follows on later lines.
const RE_REPLY = /^↩?\s*Replying to (.+?,\s*\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}:\d{2})\s*:/;

/** US Central offset for a given Y-M-D (CDT -05:00 during DST, else CST -06:00). */
function centralOffset(year: number, month: number, day: number): string {
  // DST: 2nd Sunday of March 02:00 → 1st Sunday of November 02:00.
  const firstOfMonthDow = (m: number) => new Date(Date.UTC(year, m, 1)).getUTCDay();
  const secondSundayMarch = 14 - ((firstOfMonthDow(2) + 6) % 7);
  const firstSundayNov = 7 - ((firstOfMonthDow(10) + 6) % 7);
  const afterStart = month > 3 || (month === 3 && day >= secondSundayMarch);
  const beforeEnd = month < 11 || (month === 11 && day < firstSundayNov);
  return afterStart && beforeEnd ? "-05:00" : "-06:00";
}

function toIso(y: string, mo: string, d: string, hh: string, mm: string, ss: string): string | null {
  const offset = centralOffset(Number(y), Number(mo), Number(d));
  const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${offset}`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function normalizeText(t: string): string {
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

export function parseIMessageTxt(
  rawText: string,
  opts: { ownerName: string; ownerPhone: string; conversationName?: string },
): ParseResult {
  const convName = opts.conversationName ?? "The League";
  const stats: ParseStats = {
    pagesProcessed: 0, emptyPages: [], ocrPages: [], messages: 0, uniqueSenders: [],
    ownerMessages: 0, systemMessages: 0, missingTimestamps: 0, attachments: 0, reactions: 0,
    replies: 0, duplicates: 0, lowConfidence: 0, orphanTextBlocks: 0, warnings: [],
  };

  // Split into blocks on the dashed delimiter lines.
  const lines = rawText.split(/\r?\n/);
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (RE_DELIM.test(line)) {
      if (current.length) blocks.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  const messages: ParsedMessage[] = [];
  const seen = new Set<string>();
  const senderSet = new Set<string>();

  for (const block of blocks) {
    // Drop leading/trailing blank lines; skip the conversation-name line.
    const trimmed = [...block];
    while (trimmed.length && trimmed[0].trim() === "") trimmed.shift();
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === "") trimmed.pop();
    if (trimmed.length === 0) continue;
    if (trimmed[0].trim() === convName) trimmed.shift();
    if (trimmed.length === 0) continue;

    const header = trimmed.shift()!;
    const hm = header.match(RE_HEADER);
    if (!hm) {
      stats.orphanTextBlocks++;
      continue;
    }
    const [, y, mo, d, hh, mm, ss, fromName, fromPhone, toMarker, notif] = hm;
    const timestamp = toIso(y, mo, d, hh, mm, ss);

    const isSystem = !!notif;
    const isOwner = !!toMarker;
    const senderName = fromName ? fromName.trim() : isOwner ? opts.ownerName : null;
    const senderPhone = fromPhone ? normalizePhone(fromPhone) : isOwner ? opts.ownerPhone : null;

    // Body: skip leading blanks, then collect text while pulling out reactions/media.
    const reactions: string[] = [];
    let hasAttachment = false;
    let attachmentNote: string | null = null;
    let replyToRaw: string | null = null;
    const textLines: string[] = [];
    for (const raw of trimmed) {
      const t = raw.trim();
      if (t === "") continue;
      const replyMatch = t.match(RE_REPLY);
      if (replyMatch) {
        replyToRaw = replyMatch[1].trim();
        continue; // drop the quoted-preview line; real text follows
      }
      if (RE_REACTION.test(t)) {
        reactions.push(t);
        continue;
      }
      if (RE_MEDIA.test(t)) {
        hasAttachment = true;
        const note = t.replace(RE_MEDIA, "").trim();
        if (note) attachmentNote = attachmentNote ? `${attachmentNote}; ${note}` : note;
        continue;
      }
      textLines.push(t);
    }
    const text = textLines.join("\n").trim();

    // Drop truly-empty blocks (no text, media, reaction, reply, or system event).
    if (!text && !hasAttachment && !isSystem && reactions.length === 0 && !replyToRaw) {
      stats.orphanTextBlocks++;
      continue;
    }
    if (replyToRaw) stats.replies++;

    let confidence = 1;
    if (!timestamp) confidence -= 0.4;
    if (!text && !hasAttachment && !isSystem) confidence -= 0.4; // reaction-only
    confidence = Math.max(0, Number(confidence.toFixed(2)));

    const rawId = isOwner ? senderPhone ?? "owner" : senderPhone ?? senderName ?? "unknown";
    const dedupKey = `${timestamp ?? header}|${rawId}|${normalizeText(text)}`;
    if (seen.has(dedupKey)) {
      stats.duplicates++;
      continue;
    }
    seen.add(dedupKey);

    const msg: ParsedMessage = {
      page: 0, // no pages in the txt export
      rawTimestamp: `${y}-${mo}-${d} ${hh}:${mm}:${ss}`,
      timestamp,
      rawSender: fromName ? `${senderName} (${senderPhone})` : isOwner ? "to The League" : "notification",
      senderName,
      senderPhone,
      isOwner,
      isSystem,
      text,
      hasAttachment,
      attachmentNote,
      replyToRaw,
      reactions,
      confidence,
      dedupKey,
    };
    messages.push(msg);
    stats.messages++;
    if (isOwner) stats.ownerMessages++;
    if (isSystem) stats.systemMessages++;
    if (!timestamp) stats.missingTimestamps++;
    if (hasAttachment) stats.attachments++;
    stats.reactions += reactions.length;
    if (confidence < 0.6) stats.lowConfidence++;
    if (!isSystem) senderSet.add(isOwner ? `${opts.ownerName} (${opts.ownerPhone})` : (msg.rawSender ?? "unknown"));
  }

  stats.uniqueSenders = [...senderSet].sort();
  return { messages, stats };
}
