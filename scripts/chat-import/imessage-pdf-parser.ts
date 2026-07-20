/**
 * Pure parser for the "Messages - The League" iMessage PDF export
 * (Decipher/PhoneView-style), operating on `pdftotext -layout` output.
 *
 * No DB, no filesystem — text in, structured messages + stats out, so it can
 * be unit-tested and dry-run offline. The DB upload lives in cli.ts.
 *
 * Observed layout (one message block):
 *   <TIMESTAMP>                e.g. "7/27/23 4:37:40 PM CDT (Read 7/27/23 4:47:28 PM CDT)"
 *   <Sender Name (+phone)>     absent for the export owner's own messages
 *   <blank>
 *   <text ...>                 may span multiple lines and across page breaks
 *   [reaction line]            "<glyph> Name reacted with on 7/27/23, 4:43 PM" (emoji lost in text layer)
 *   [reply block]              "Replying to Name, YYYY-MM-DD HH:MM:SS: ... " then the actual reply text
 *   [attachment]               "Attachment not found:" / "<file> (Attachment)"
 */

export interface ParsedMessage {
  page: number;
  rawTimestamp: string;
  timestamp: string | null; // ISO 8601, or null if unparseable
  rawSender: string | null; // e.g. "Patrick Schwing (+15042849434)"
  senderName: string | null;
  senderPhone: string | null;
  isOwner: boolean;
  isSystem: boolean;
  text: string;
  hasAttachment: boolean;
  attachmentNote: string | null;
  replyToRaw: string | null;
  reactions: string[];
  confidence: number;
  dedupKey: string;
}

export interface ParseStats {
  pagesProcessed: number;
  emptyPages: number[];
  ocrPages: number[]; // pages whose text layer was empty/near-empty (likely image-only)
  messages: number;
  uniqueSenders: string[];
  ownerMessages: number;
  systemMessages: number;
  missingTimestamps: number;
  attachments: number;
  reactions: number;
  replies: number;
  duplicates: number;
  lowConfidence: number;
  orphanTextBlocks: number; // text before the first timestamp on a page-run
  warnings: string[];
}

export interface ParseResult {
  messages: ParsedMessage[];
  stats: ParseStats;
}

export interface ParseOptions {
  ownerName: string;
  ownerPhone: string;
  /** Fallback starting page number if footer "Page N of M" markers are absent. */
  startPage: number;
}

const RE_TIMESTAMP =
  /^\s*(\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M\s+[A-Z]{2,4})(\s*\(Read\b[^)]*\))?\s*$/;
const RE_SENDER = /^\s*([A-Za-z][A-Za-z .,'’-]*?)\s*\((\+?\d[\d\s().-]{6,})\)\s*$/;
const RE_PAGE_FOOTER = /^\s*Page\s+(\d+)\s+of\s+(\d+)\s*$/;
const RE_HEADER = /^\s*Messages\s*-\s*The League\b/;
const RE_REACTION = /reacted with\b.*\bon\b/i;
const RE_REPLY = /^\s*Replying to\s+(.+?,\s*\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2})\s*:/;
const RE_MEDIA = /\((Image|Video|Audio|GIF|Attachment|Contact|Location|vCard|Sticker)\)\s*$/i;
const RE_ATTACHMENT = /^Attachment not found:\s*$/i;
const RE_SYSTEM =
  /\b(named the conversation|joined the conversation|left the conversation|was added|was removed|changed the group (name|photo)|removed .* from the conversation|added .* to the conversation)\b/i;

const TZ_OFFSETS: Record<string, string> = {
  CDT: "-05:00", CST: "-06:00", EDT: "-04:00", EST: "-05:00",
  MDT: "-06:00", MST: "-07:00", PDT: "-07:00", PST: "-08:00", UTC: "+00:00", GMT: "+00:00",
};

/** "7/27/23 5:02:50 PM CDT" -> ISO string (or null). */
export function parseTimestamp(raw: string): string | null {
  const m = raw
    .trim()
    .match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)\s+([A-Z]{2,4})$/);
  if (!m) return null;
  const [, mo, d, y, hh, mm, ss, ap, tz] = m;
  let year = Number(y);
  if (year < 100) year += 2000;
  let hour = Number(hh) % 12;
  if (ap === "PM") hour += 12;
  const offset = TZ_OFFSETS[tz] ?? "+00:00";
  const iso = `${year.toString().padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hour
    .toString()
    .padStart(2, "0")}:${mm}:${ss}${offset}`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function normalizeText(t: string): string {
  return t.replace(/�/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

interface Line {
  text: string;
  page: number;
}

export function parseIMessagePdfText(rawText: string, opts: ParseOptions): ParseResult {
  const stats: ParseStats = {
    pagesProcessed: 0,
    emptyPages: [],
    ocrPages: [],
    messages: 0,
    uniqueSenders: [],
    ownerMessages: 0,
    systemMessages: 0,
    missingTimestamps: 0,
    attachments: 0,
    reactions: 0,
    replies: 0,
    duplicates: 0,
    lowConfidence: 0,
    orphanTextBlocks: 0,
    warnings: [],
  };

  // Split into pages on form-feed; track the true page number from the footer.
  const pageChunks = rawText.split("\f");
  const lines: Line[] = [];
  let seq = opts.startPage;
  for (let i = 0; i < pageChunks.length; i++) {
    const chunk = pageChunks[i];
    if (chunk.trim() === "" && i === pageChunks.length - 1) continue; // trailing FF
    stats.pagesProcessed++;
    let pageNum = seq;
    const rawLines = chunk.split(/\r?\n/);
    const footer = rawLines.find((l) => RE_PAGE_FOOTER.test(l));
    if (footer) {
      const fm = footer.match(RE_PAGE_FOOTER);
      if (fm) pageNum = Number(fm[1]);
    }
    seq = pageNum + 1;

    const contentLines = rawLines.filter(
      (l) => !RE_HEADER.test(l) && !RE_PAGE_FOOTER.test(l),
    );
    const nonEmpty = contentLines.filter((l) => l.trim() !== "");
    if (nonEmpty.length === 0) {
      stats.emptyPages.push(pageNum);
      stats.ocrPages.push(pageNum); // empty text layer => candidate for OCR
      continue;
    }
    for (const l of contentLines) lines.push({ text: l, page: pageNum });
  }

  const messages: ParsedMessage[] = [];
  const seen = new Set<string>();
  const senderSet = new Set<string>();

  let cur: ParsedMessage | null = null;
  let sawSenderForCur = false;
  let inReplyQuote = false;

  const finalize = () => {
    if (!cur) return;
    cur.text = cur.text.replace(/�/g, "").replace(/[ \t]+\n/g, "\n").trim();
    // Drop empty noise blocks (a bare timestamp with no sender/text/media) —
    // these are layout artifacts, not real messages.
    if (!cur.text && !cur.hasAttachment && !cur.isSystem && cur.reactions.length === 0 && !cur.replyToRaw) {
      cur = null;
      sawSenderForCur = false;
      inReplyQuote = false;
      return;
    }
    // confidence scoring
    let c = 1;
    if (!cur.timestamp) c -= 0.4;
    if (cur.isOwner && !cur.isSystem) c -= 0.1; // owner is inferred (no sender line)
    if (!cur.text && !cur.hasAttachment) c -= 0.5;
    cur.confidence = Math.max(0, Number(c.toFixed(2)));
    if (cur.confidence < 0.6) stats.lowConfidence++;

    cur.dedupKey = `${cur.timestamp ?? cur.rawTimestamp}|${cur.senderPhone ?? "owner"}|${normalizeText(cur.text)}`;
    if (seen.has(cur.dedupKey)) {
      stats.duplicates++;
    } else {
      seen.add(cur.dedupKey);
      messages.push(cur);
      stats.messages++;
      if (cur.isOwner) stats.ownerMessages++;
      if (cur.isSystem) stats.systemMessages++;
      if (!cur.timestamp) stats.missingTimestamps++;
      if (cur.hasAttachment) stats.attachments++;
      stats.reactions += cur.reactions.length;
      if (cur.replyToRaw) stats.replies++;
      const key = cur.isOwner ? `${opts.ownerName} (${opts.ownerPhone})` : (cur.rawSender ?? "unknown");
      senderSet.add(key);
    }
    cur = null;
    sawSenderForCur = false;
    inReplyQuote = false;
  };

  for (const { text: line, page } of lines) {
    const trimmed = line.trim();

    // New message boundary
    const tsMatch = line.match(RE_TIMESTAMP);
    if (tsMatch) {
      finalize();
      const rawTs = tsMatch[1].trim();
      cur = {
        page,
        rawTimestamp: rawTs,
        timestamp: parseTimestamp(rawTs),
        rawSender: null,
        senderName: null,
        senderPhone: null,
        isOwner: false,
        isSystem: false,
        text: "",
        hasAttachment: false,
        attachmentNote: null,
        replyToRaw: null,
        reactions: [],
        confidence: 1,
        dedupKey: "",
      };
      sawSenderForCur = false;
      inReplyQuote = false;
      continue;
    }

    if (trimmed === "") continue;

    // Skip the multi-line quoted preview of a reply (delimited by � … �). The
    // real reply text — if any — comes after the closing glyph.
    if (inReplyQuote) {
      if (/�\s*$/.test(line)) inReplyQuote = false;
      continue;
    }

    if (!cur) {
      // Text before the first timestamp of the run — orphan (e.g. page-1 header artifact).
      if (!RE_SYSTEM.test(trimmed) && !RE_REACTION.test(trimmed)) stats.orphanTextBlocks++;
      continue;
    }

    // Sender line (only the first one after a timestamp identifies the sender)
    const senderMatch = line.match(RE_SENDER);
    if (senderMatch && !sawSenderForCur && cur.text === "") {
      cur.rawSender = trimmed;
      cur.senderName = senderMatch[1].trim();
      cur.senderPhone = normalizePhone(senderMatch[2]);
      cur.isOwner = false;
      sawSenderForCur = true;
      continue;
    }

    // If no sender line has appeared yet and this is body text, it's the owner.
    if (!sawSenderForCur && !cur.isOwner) {
      cur.isOwner = true;
      cur.senderName = opts.ownerName;
      cur.senderPhone = opts.ownerPhone;
      sawSenderForCur = true;
      // fall through to treat this line as content
    }

    // Reaction line -> metadata, not body
    if (RE_REACTION.test(trimmed)) {
      cur.reactions.push(trimmed.replace(/�/g, "").trim());
      continue;
    }

    // System message
    if (RE_SYSTEM.test(trimmed)) {
      cur.isSystem = true;
      cur.text = (cur.text ? cur.text + "\n" : "") + trimmed.replace(/�/g, "").trim();
      continue;
    }

    // Reply block: "Replying to Name, date: � quoted … �" then the real text.
    // The quote may be one line (opening line already ends with �) or many.
    const replyMatch = line.match(RE_REPLY);
    if (replyMatch) {
      cur.replyToRaw = replyMatch[1].trim();
      const afterColon = line.slice(line.indexOf(":") + 1);
      inReplyQuote = !/�[^�]*�\s*$/.test(afterColon) && !/�\s*$/.test(line) ? true : false;
      continue;
    }

    // "Attachment not found:" header line — the next line names the media.
    if (RE_ATTACHMENT.test(line)) {
      cur.hasAttachment = true;
      continue;
    }
    // Media descriptor line, e.g. "tmp.gif (Image)", "IMG_0001.jpeg (Attachment)".
    if (RE_MEDIA.test(line)) {
      cur.hasAttachment = true;
      const note = trimmed.replace(RE_MEDIA, "").trim();
      if (note) cur.attachmentNote = (cur.attachmentNote ? cur.attachmentNote + "; " : "") + note;
      continue;
    }

    // Ordinary body text.
    cur.text = cur.text ? `${cur.text}\n${trimmed}` : trimmed;
  }
  finalize();

  stats.uniqueSenders = [...senderSet].sort();
  return { messages, stats };
}
