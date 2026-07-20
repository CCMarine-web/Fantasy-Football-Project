import "dotenv/config";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { parseIMessageTxt } from "./imessage-txt-parser";
import { buildResolver, resolve, type Resolver } from "./identity-resolver";
import type { ParsedMessage } from "./imessage-pdf-parser";

/**
 * Full import of the plain-text iMessage export. Cleaner + faster than the PDF
 * pipeline (no OCR, explicit senders). Bulk-inserts via createMany.
 *
 *   npx tsx scripts/chat-import/import-txt.ts --dry-run
 *   npx tsx scripts/chat-import/import-txt.ts --reset      # clear prior imports first
 *
 * Every message lands PENDING (admin-only) until approved.
 */

const DEFAULT_TXT =
  "C:\\Users\\antho\\Downloads\\wetransfer_fantasy-football_2026-07-19_2334\\Messages - The League.txt";
const OWNER_NAME = "Anthony Cibilich";
const OWNER_PHONE = "+15042349105";
const OUTPUT_DIR = join(process.cwd(), "private", "extracts");

function arg(flag: string, def?: string) {
  const a = process.argv.slice(2);
  const i = a.indexOf(flag);
  return i >= 0 && a[i + 1] && !a[i + 1].startsWith("--") ? a[i + 1] : def;
}
const DRY = process.argv.includes("--dry-run");
const RESET = process.argv.includes("--reset");
const TXT = arg("--txt", DEFAULT_TXT)!;
const BATCH = Number(arg("--batch", "500"));

function senderRawId(m: ParsedMessage): string {
  if (m.isSystem) return "system";
  return m.isOwner ? m.senderPhone ?? "owner" : m.senderPhone ?? m.senderName ?? "unknown";
}

async function main() {
  if (!existsSync(TXT)) throw new Error(`TXT not found: ${TXT}`);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Parsing ${TXT} ...`);
  const raw = readFileSync(TXT, "utf8");
  const { messages, stats } = parseIMessageTxt(raw, { ownerName: OWNER_NAME, ownerPhone: OWNER_PHONE });

  // Resolve senders + count unresolved (non-owner, non-system without a manager).
  const resolver: Resolver = DRY
    ? { byPhone: new Map(), byName: new Map() }
    : await buildResolver();
  const unresolved = new Map<string, number>();
  if (!DRY) {
    for (const m of messages) {
      if (m.isOwner || m.isSystem) continue;
      if (!resolve(m, resolver)) unresolved.set(m.rawSender ?? senderRawId(m), (unresolved.get(m.rawSender ?? senderRawId(m)) ?? 0) + 1);
    }
  }

  // Persist a private JSON sample for inspection.
  writeFileSync(
    join(OUTPUT_DIR, "chat-txt-parse-sample.json"),
    JSON.stringify({ count: messages.length, sample: messages.slice(0, 200) }, null, 2),
  );

  const line = "─".repeat(58);
  console.log(`\n${line}\nTXT CHAT IMPORT — ${DRY ? "DRY RUN" : "FULL IMPORT"}\n${line}`);
  console.log(`Messages parsed .......... ${stats.messages}`);
  console.log(`  ├─ owner (Anthony) ..... ${stats.ownerMessages}`);
  console.log(`  └─ system events ....... ${stats.systemMessages}`);
  console.log(`Unique senders ........... ${stats.uniqueSenders.length}`);
  stats.uniqueSenders.forEach((s) => console.log(`     • ${s}`));
  console.log(`Missing timestamps ....... ${stats.missingTimestamps}`);
  console.log(`Duplicate messages ....... ${stats.duplicates}`);
  console.log(`Attachments/media ........ ${stats.attachments}`);
  console.log(`Reactions (emoji kept) ... ${stats.reactions}`);
  console.log(`Low-confidence msgs ...... ${stats.lowConfidence}`);
  console.log(`Skipped empty blocks ..... ${stats.orphanTextBlocks}`);
  if (!DRY) {
    console.log(`Unresolved senders ....... ${unresolved.size}`);
    [...unresolved.entries()].forEach(([s, n]) => console.log(`     • ${s} (${n})`));
  }
  console.log(line);

  if (DRY) {
    console.log("\n[DRY RUN] No DB writes. Sample -> private/extracts/chat-txt-parse-sample.json");
    return;
  }

  if (RESET) {
    const imports = await prisma.chatImport.findMany({ select: { id: true } });
    for (const imp of imports) {
      await prisma.chatMessage.deleteMany({ where: { chatImportId: imp.id } });
      await prisma.chatParticipant.deleteMany({ where: { chatImportId: imp.id } });
    }
    await prisma.chatImport.deleteMany({});
    console.log(`Reset: cleared ${imports.length} prior chat import(s).`);
  }

  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (!admin) throw new Error("No ADMIN user found to own the ChatImport.");
  const imp = await prisma.chatImport.create({
    data: {
      uploadedByUserId: admin.id,
      sourcePlatform: "IMESSAGE",
      originalFileName: "Messages - The League.txt",
      fileSizeBytes: raw.length,
      status: "PARSING",
    },
  });
  console.log(`\nCreated ChatImport ${imp.id}. Inserting ${messages.length} messages ...`);

  // One ChatParticipant per unique raw identifier, linked to a manager if resolved.
  const participantId = new Map<string, string>();
  const uniqueRawIds = [...new Set(messages.map(senderRawId))];
  for (const rawId of uniqueRawIds) {
    const sample = messages.find((m) => senderRawId(m) === rawId)!;
    const managerId = sample.isOwner
      ? resolver.byPhone.get(sample.senderPhone ?? "") ?? null
      : resolve(sample, resolver);
    const p = await prisma.chatParticipant.create({
      data: { chatImportId: imp.id, rawIdentifier: rawId, linkedManagerId: managerId },
    });
    participantId.set(rawId, p.id);
  }

  // Bulk insert messages in batches.
  let inserted = 0;
  for (let i = 0; i < messages.length; i += BATCH) {
    const chunk = messages.slice(i, i + BATCH);
    await prisma.chatMessage.createMany({
      data: chunk.map((m) => {
        const rawId = senderRawId(m);
        const managerId = m.isOwner ? resolver.byPhone.get(m.senderPhone ?? "") ?? null : resolve(m, resolver);
        const meta =
          m.attachmentNote || m.reactions.length || m.replyToRaw
            ? {
                note: m.attachmentNote ?? undefined,
                reactions: m.reactions.length ? m.reactions : undefined,
                replyTo: m.replyToRaw ?? undefined,
              }
            : undefined;
        return {
          chatImportId: imp.id,
          participantId: participantId.get(rawId)!,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(0),
          text: m.text || null,
          hasAttachment: m.hasAttachment,
          attachmentsMeta: meta,
          sourcePlatform: "IMESSAGE" as const,
          linkedManagerId: managerId,
          rawSender: m.rawSender,
          normalizedSender: rawId,
          parseConfidence: m.confidence,
        };
      }),
      skipDuplicates: true,
    });
    inserted += chunk.length;
    if (i % (BATCH * 10) === 0) console.log(`  … ${inserted}/${messages.length}`);
  }

  await prisma.chatImport.update({
    where: { id: imp.id },
    data: { status: "PARSED", messageCount: inserted, completedAt: new Date() },
  });
  console.log(`\nDone. Inserted ${inserted} messages (all PENDING/admin-only) into ChatImport ${imp.id}.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
