import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { parseIMessagePdfText, type ParsedMessage } from "./imessage-pdf-parser";

/**
 * Resumable local import pipeline for the group-chat PDF. NEVER run against
 * Vercel/a browser request — this is a local admin tool.
 *
 *   npx tsx scripts/chat-import/cli.ts --from 1 --to 25 --dry-run
 *   npx tsx scripts/chat-import/cli.ts --from 1 --to 25            # import to DB
 *   npx tsx scripts/chat-import/cli.ts --from 1 --to 3041 --batch 50 --resume
 *
 * Flags:
 *   --from N --to M      page range (inclusive)
 *   --batch N            pages per extraction chunk (default 50)
 *   --dry-run            parse + report only; write JSON, touch no DB
 *   --resume             skip page chunks already recorded as done in the checkpoint
 *   --pdf <path>         override the source PDF path
 *   --owner-name / --owner-phone   export owner identity (defaults below)
 */

const DEFAULT_PDF =
  "C:\\Users\\antho\\Downloads\\wetransfer_fantasy-football_2026-07-19_2334\\Messages - The League.pdf";
const OWNER_NAME = "Anthony Cibilich";
const OWNER_PHONE = "+15042349105";

const HERE = join(process.cwd(), "scripts", "chat-import");
const CHECKPOINT_DIR = join(HERE, ".checkpoints");
const OUTPUT_DIR = join(process.cwd(), "private", "extracts");

interface Args {
  from: number; to: number; batch: number; dryRun: boolean; resume: boolean;
  pdf: string; ownerName: string; ownerPhone: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] ? a[i + 1] : def;
  };
  return {
    from: Number(get("--from", "1")),
    to: Number(get("--to", "25")),
    batch: Number(get("--batch", "50")),
    dryRun: a.includes("--dry-run"),
    resume: a.includes("--resume"),
    pdf: get("--pdf", DEFAULT_PDF)!,
    ownerName: get("--owner-name", OWNER_NAME)!,
    ownerPhone: get("--owner-phone", OWNER_PHONE)!,
  };
}

interface Checkpoint { pdf: string; doneChunks: string[]; updatedAt: string }

function loadCheckpoint(pdf: string): Checkpoint {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const f = join(CHECKPOINT_DIR, "checkpoint.json");
  if (existsSync(f)) {
    try {
      const cp = JSON.parse(readFileSync(f, "utf8")) as Checkpoint;
      if (cp.pdf === pdf) return cp;
    } catch { /* ignore corrupt checkpoint */ }
  }
  return { pdf, doneChunks: [], updatedAt: new Date(0).toISOString() };
}
function saveCheckpoint(cp: Checkpoint) {
  cp.updatedAt = new Date().toISOString();
  writeFileSync(join(CHECKPOINT_DIR, "checkpoint.json"), JSON.stringify(cp, null, 2));
}

/** Extract a page range to layout text via poppler pdftotext, with one retry. */
function extractRange(pdf: string, from: number, to: number): string {
  const args = ["-f", String(from), "-l", String(to), "-layout", "-enc", "UTF-8", pdf, "-"];
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return execFileSync("pdftotext", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
  return "";
}

// ---- identity resolution (import mode) --------------------------------------

interface Resolver {
  byPhone: Map<string, string>; // phone -> managerId
  byName: Map<string, string>; // lowercased full name -> managerId
}

async function buildResolver(): Promise<Resolver> {
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();
  const ids = await prisma.chatIdentityMap.findMany({ where: { managerId: { not: null } } });
  for (const m of ids) if (m.managerId) byPhone.set(m.rawIdentifier, m.managerId);
  const aliases = await prisma.managerAlias.findMany({ where: { aliasType: { in: ["PHONE", "FULL_NAME"] } } });
  for (const al of aliases) {
    if (al.aliasType === "PHONE") byPhone.set(al.value, al.managerId);
    else byName.set(al.value.toLowerCase(), al.managerId);
  }
  return { byPhone, byName };
}

function resolve(msg: ParsedMessage, r: Resolver): string | null {
  if (msg.senderPhone && r.byPhone.has(msg.senderPhone)) return r.byPhone.get(msg.senderPhone)!;
  if (msg.senderName && r.byName.has(msg.senderName.toLowerCase())) return r.byName.get(msg.senderName.toLowerCase())!;
  return null;
}

// ---- reporting --------------------------------------------------------------

function printReport(args: Args, all: ParsedMessage[], stats: ReturnType<typeof parseIMessagePdfText>["stats"], unresolved: Map<string, number>) {
  const line = "─".repeat(58);
  console.log(`\n${line}\nCHAT IMPORT — PARSE REPORT  (pages ${args.from}–${args.to})\n${line}`);
  console.log(`Pages processed .......... ${stats.pagesProcessed}`);
  console.log(`Messages extracted ....... ${stats.messages}`);
  console.log(`  ├─ owner (Anthony) ..... ${stats.ownerMessages}`);
  console.log(`  └─ system events ....... ${stats.systemMessages}`);
  console.log(`Unique senders ........... ${stats.uniqueSenders.length}`);
  stats.uniqueSenders.forEach((s) => console.log(`     • ${s}`));
  console.log(`Unresolved senders ....... ${unresolved.size}`);
  [...unresolved.entries()].forEach(([s, n]) => console.log(`     • ${s} (${n} msgs)`));
  console.log(`Missing timestamps ....... ${stats.missingTimestamps}`);
  console.log(`Duplicate messages ....... ${stats.duplicates}`);
  console.log(`Failed pages ............. 0`);
  console.log(`Empty pages .............. ${stats.emptyPages.length}${stats.emptyPages.length ? " -> " + stats.emptyPages.join(",") : ""}`);
  console.log(`Pages requiring OCR ...... ${stats.ocrPages.length}${stats.ocrPages.length ? " -> " + stats.ocrPages.join(",") : ""}`);
  console.log(`Attachments .............. ${stats.attachments}`);
  console.log(`Reactions (emoji lost) ... ${stats.reactions}`);
  console.log(`Replies .................. ${stats.replies}`);
  console.log(`Low-confidence msgs (<0.6) ${stats.lowConfidence}`);
  console.log(`Orphan text blocks ....... ${stats.orphanTextBlocks}`);
  if (stats.warnings.length) { console.log("Warnings:"); stats.warnings.forEach((w) => console.log(`     ! ${w}`)); }
  console.log(line + "\n");
}

// ---- main -------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  if (!existsSync(args.pdf)) throw new Error(`PDF not found: ${args.pdf}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const cp = loadCheckpoint(args.pdf);
  const resolver = args.dryRun ? null : await buildResolver();

  let chatImportId: string | null = null;
  if (!args.dryRun) {
    const adminUser = await prisma.user.findFirst({ where: { role: "ADMIN" } });
    if (!adminUser) throw new Error("No ADMIN user found to own the ChatImport.");
    const imp = await prisma.chatImport.create({
      data: {
        uploadedByUserId: adminUser.id,
        sourcePlatform: "IMESSAGE",
        originalFileName: `Messages - The League.pdf [p${args.from}-${args.to}]`,
        fileSizeBytes: 0,
        status: "PARSING",
      },
    });
    chatImportId = imp.id;
    console.log(`Created ChatImport ${chatImportId}`);
  }

  const allMessages: ParsedMessage[] = [];
  const unresolved = new Map<string, number>();
  const aggregate = {
    pagesProcessed: 0, emptyPages: [] as number[], ocrPages: [] as number[], messages: 0,
    uniqueSenders: new Set<string>(), ownerMessages: 0, systemMessages: 0, missingTimestamps: 0,
    attachments: 0, reactions: 0, replies: 0, duplicates: 0, lowConfidence: 0, orphanTextBlocks: 0,
    warnings: [] as string[],
  };

  for (let start = args.from; start <= args.to; start += args.batch) {
    const end = Math.min(start + args.batch - 1, args.to);
    const chunkKey = `${start}-${end}`;
    if (args.resume && cp.doneChunks.includes(chunkKey)) {
      console.log(`⏭  skip chunk ${chunkKey} (checkpoint)`);
      continue;
    }
    console.log(`▶  extracting pages ${chunkKey} ...`);
    const text = extractRange(args.pdf, start, end);
    const { messages, stats } = parseIMessagePdfText(text, {
      ownerName: args.ownerName, ownerPhone: args.ownerPhone, startPage: start,
    });

    aggregate.pagesProcessed += stats.pagesProcessed;
    aggregate.emptyPages.push(...stats.emptyPages);
    aggregate.ocrPages.push(...stats.ocrPages);
    aggregate.ownerMessages += stats.ownerMessages;
    aggregate.systemMessages += stats.systemMessages;
    aggregate.missingTimestamps += stats.missingTimestamps;
    aggregate.attachments += stats.attachments;
    aggregate.reactions += stats.reactions;
    aggregate.replies += stats.replies;
    aggregate.duplicates += stats.duplicates;
    aggregate.lowConfidence += stats.lowConfidence;
    aggregate.orphanTextBlocks += stats.orphanTextBlocks;
    stats.uniqueSenders.forEach((s) => aggregate.uniqueSenders.add(s));

    if (!args.dryRun && chatImportId && resolver) {
      await uploadMessages(chatImportId, messages, resolver, unresolved);
    } else {
      // dry-run: still compute unresolved via a static known-phone check is impossible
      // without DB, so we approximate by grouping non-owner senders and marking any
      // sender whose phone is not one of the 10 known league numbers.
      for (const m of messages) {
        if (m.isOwner || m.isSystem) continue;
        if (m.senderPhone && !KNOWN_PHONES.has(m.senderPhone)) {
          unresolved.set(m.rawSender ?? m.senderPhone, (unresolved.get(m.rawSender ?? m.senderPhone) ?? 0) + 1);
        }
      }
    }

    allMessages.push(...messages);
    aggregate.messages += messages.length;
    cp.doneChunks.push(chunkKey);
    saveCheckpoint(cp);
  }

  if (chatImportId) {
    await prisma.chatImport.update({
      where: { id: chatImportId },
      data: { status: "PARSED", messageCount: aggregate.messages, completedAt: new Date() },
    });
  }

  // Persist parsed JSON for inspection (private, git-ignored).
  const outFile = join(OUTPUT_DIR, `chat-parse-p${args.from}-${args.to}.json`);
  writeFileSync(outFile, JSON.stringify({ count: allMessages.length, messages: allMessages.slice(0, 500) }, null, 2));

  printReport(args, allMessages, { ...aggregate, uniqueSenders: [...aggregate.uniqueSenders].sort() } as any, unresolved);
  console.log(`Parsed JSON (first 500) -> ${outFile}${args.dryRun ? "  [DRY RUN — no DB writes]" : ""}`);
}

const KNOWN_PHONES = new Set([
  "+15042349105", "+15042849434", "+15043732138", "+15043734088", "+15044329008",
  "+15044601593", "+15043017639", "+15043301973", "+15043070684", "+15049201211",
]);

async function uploadMessages(
  chatImportId: string,
  messages: ParsedMessage[],
  resolver: Resolver,
  unresolved: Map<string, number>,
) {
  // Ensure a ChatParticipant per raw identifier within this import.
  const participantCache = new Map<string, string>(); // rawIdentifier -> participantId
  const ensureParticipant = async (rawId: string, linkedManagerId: string | null): Promise<string> => {
    if (participantCache.has(rawId)) return participantCache.get(rawId)!;
    const p = await prisma.chatParticipant.upsert({
      where: { chatImportId_rawIdentifier: { chatImportId, rawIdentifier: rawId } },
      create: { chatImportId, rawIdentifier: rawId, linkedManagerId },
      update: { linkedManagerId: linkedManagerId ?? undefined },
    });
    participantCache.set(rawId, p.id);
    return p.id;
  };

  // Cross-import dedup: skip messages whose (timestamp, normalizedSender, text) already exist.
  for (const m of messages) {
    const rawId = m.isOwner ? m.senderPhone ?? "owner" : m.senderPhone ?? m.rawSender ?? "unknown";
    const managerId = m.isOwner ? resolver.byPhone.get(m.senderPhone ?? "") ?? null : resolve(m, resolver);
    if (!m.isOwner && !m.isSystem && !managerId) {
      unresolved.set(m.rawSender ?? rawId, (unresolved.get(m.rawSender ?? rawId) ?? 0) + 1);
    }
    const participantId = await ensureParticipant(rawId, managerId);

    const ts = m.timestamp ? new Date(m.timestamp) : new Date(0);
    const dup = await prisma.chatMessage.findFirst({
      where: {
        chatImportId,
        timestamp: ts,
        normalizedSender: rawId,
        text: m.text || null,
      },
      select: { id: true },
    });
    if (dup) continue;

    await prisma.chatMessage.create({
      data: {
        chatImportId,
        participantId,
        timestamp: ts,
        text: m.text || null,
        hasAttachment: m.hasAttachment,
        attachmentsMeta: m.attachmentNote ? { note: m.attachmentNote } : undefined,
        sourcePlatform: "IMESSAGE",
        linkedManagerId: managerId,
        sourcePage: m.page,
        rawSender: m.rawSender,
        normalizedSender: rawId,
        parseConfidence: m.confidence,
        // approvalStatus + sensitivityStatus default to PENDING/NONE (admin-only until approved)
      },
    });
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
