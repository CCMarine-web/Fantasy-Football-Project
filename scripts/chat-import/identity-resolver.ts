import { prisma } from "@/lib/db";
import type { ParsedMessage } from "./imessage-pdf-parser";

/** Shared sender->manager resolver used by both the PDF and TXT importers. */
export interface Resolver {
  byPhone: Map<string, string>; // phone -> managerId
  byName: Map<string, string>; // lowercased full name -> managerId
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

export async function buildResolver(): Promise<Resolver> {
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

export function resolve(msg: ParsedMessage, r: Resolver): string | null {
  if (msg.senderPhone && r.byPhone.has(msg.senderPhone)) return r.byPhone.get(msg.senderPhone)!;
  if (msg.senderName && r.byName.has(msg.senderName.toLowerCase())) return r.byName.get(msg.senderName.toLowerCase())!;
  return null;
}
