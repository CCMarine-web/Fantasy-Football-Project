import "dotenv/config";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import type { AliasType } from "@/generated/prisma/client";

/**
 * One-time (idempotent) identity seeding from the WeTransfer sources:
 *  - sets each manager's real displayName + optimized profile photo
 *  - seeds ManagerAlias (full/first name, sleeper username, team names, phone)
 *  - seeds ChatIdentityMap (phone -> manager) for chat imports
 *  - registers MediaAsset(PROFILE) records
 *
 * Photos flagged uncertain (Schwing/Quinn mislabel) are optimized + registered
 * as PENDING MediaAssets but NOT wired to photoUrl — those managers show
 * fallback initials until an admin confirms the photo.
 *
 * Safe to re-run. Requires the source folder to exist locally; it only copies
 * optimized derivatives into public/managers (committed), never the raw files.
 */

const SRC = "C:\\Users\\antho\\Downloads\\wetransfer_fantasy-football_2026-07-19_2334";
const PROFILE_DIR = join(SRC, "Fantasy Football Managers Profile Picture");
const OUT_DIR = join(process.cwd(), "public", "managers");

interface Row {
  fullName: string;
  oldDisplayName: string; // current DB displayName (sleeper username) — used to find the manager
  firstName: string;
  currentTeam: string; // from Managers Names.xlsx
  phone?: string;
  email?: string;
  /** Exact name spellings as they appear in the chat export (may be misspelled). */
  chatNames?: string[];
  photoFile: string;
  photoConfident: boolean; // false => needs admin review, don't wire photoUrl
}

// Phone numbers verified from the "Name (+phone)" sender lines in the chat export.
const ROWS: Row[] = [
  { fullName: "Anthony Cibilich", oldDisplayName: "AnthonyCib", firstName: "Anthony", currentTeam: "Mexico City Diablos", phone: "+15042349105", email: "anthonycibilich@gmail.com", photoFile: "Anthony Cibilich.jpeg", photoConfident: true },
  { fullName: "Blake Mire", oldDisplayName: "Mirecat", firstName: "Blake", currentTeam: "Meet Me at da London", phone: "+15044329008", photoFile: "Blake Mire.jpeg", photoConfident: true },
  { fullName: "Ethan Jones", oldDisplayName: "Jonesy24811", firstName: "Ethan", currentTeam: "Bustin' Jefferson", phone: "+15043732138", photoFile: "Ethan Jones.jpeg", photoConfident: true },
  { fullName: "Gavin Detillier", oldDisplayName: "gdetillier8", firstName: "Gavin", currentTeam: "Eat My Butker", phone: "+15043070684", photoFile: "Gavin Detillier.jpeg", photoConfident: true },
  { fullName: "Logan Javier", oldDisplayName: "loganjavier", firstName: "Logan", currentTeam: "Sad Team", phone: "+15043734088", photoFile: "Logan Javier.jpeg", photoConfident: true },
  { fullName: "Michael Barkemeyer", oldDisplayName: "mbarkemeyer", firstName: "Michael", currentTeam: "Crashee Rice", phone: "+15049201211", chatNames: ["Michael Barkmeire"], photoFile: "Michael Barkemeyer.jpeg", photoConfident: true },
  { fullName: "Michael Shea", oldDisplayName: "Michaelshea7", firstName: "Michael", currentTeam: "Riley Reid Option", phone: "+15043301973", photoFile: "Michael Shea.jpeg", photoConfident: true },
  { fullName: "Patrick McManus", oldDisplayName: "thenorthernpike", firstName: "Patrick", currentTeam: "The Shea Knife", phone: "+15043017639", chatNames: ["Patrick Mcmanus"], photoFile: "Patrick McManus.jpeg", photoConfident: true },
  { fullName: "Patrick Schwing", oldDisplayName: "patrick408287", firstName: "Patrick", currentTeam: "鼠年", phone: "+15042849434", photoFile: "Patrick Schwing.jpeg", photoConfident: false },
  { fullName: "Quinn Fuentes", oldDisplayName: "quinnfuentes1", firstName: "Quinn", currentTeam: "TJ HockenZYN", phone: "+15044601593", photoFile: "Quinn Fuentes.jpeg", photoConfident: false },
];

function slug(fullName: string): string {
  return fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function optimize(srcPath: string, outPath: string): Promise<{ width: number; height: number; bytes: number }> {
  const buf = readFileSync(srcPath);
  const out = await sharp(buf)
    .rotate() // respect EXIF orientation
    .resize(512, 512, { fit: "cover", position: "attention" })
    .webp({ quality: 82 })
    .toBuffer();
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, out);
  const meta = await sharp(out).metadata();
  return { width: meta.width ?? 512, height: meta.height ?? 512, bytes: out.length };
}

async function upsertAlias(managerId: string, aliasType: AliasType, value: string, source: string, confidence = 1) {
  const v = value.trim();
  if (!v) return;
  await prisma.managerAlias.upsert({
    where: { managerId_aliasType_value: { managerId, aliasType, value: v } },
    create: { managerId, aliasType, value: v, source, confidence },
    update: { source, confidence },
  });
}

async function main() {
  if (!existsSync(PROFILE_DIR)) {
    throw new Error(`Profile source folder not found: ${PROFILE_DIR}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });

  for (const row of ROWS) {
    const manager = await prisma.manager.findFirst({
      where: { OR: [{ displayName: row.oldDisplayName }, { displayName: row.fullName }] },
    });
    if (!manager) {
      console.warn(`! No manager found for ${row.fullName} (old displayName=${row.oldDisplayName}) — skipping`);
      continue;
    }

    // 1) optimize the profile photo -> public/managers/<slug>.webp
    const outFile = `${slug(row.fullName)}.webp`;
    const srcPath = join(PROFILE_DIR, row.photoFile);
    let dims = { width: 0, height: 0, bytes: 0 };
    if (existsSync(srcPath)) {
      dims = await optimize(srcPath, join(OUT_DIR, outFile));
    } else {
      console.warn(`! Missing photo file ${srcPath}`);
    }
    const publicUrl = `/managers/${outFile}`;

    // 2) update manager: real display name; photoUrl only when confident
    await prisma.manager.update({
      where: { id: manager.id },
      data: {
        displayName: row.fullName,
        ...(row.photoConfident && dims.bytes > 0 ? { photoUrl: publicUrl } : {}),
      },
    });

    // 3) aliases
    await upsertAlias(manager.id, "FULL_NAME", row.fullName, "xlsx");
    await upsertAlias(manager.id, "FIRST_NAME", row.firstName, "xlsx", 0.6);
    await upsertAlias(manager.id, "SLEEPER_USERNAME", row.oldDisplayName, "sleeper");
    await upsertAlias(manager.id, "TEAM_NAME", row.currentTeam, "xlsx");
    if (row.phone) await upsertAlias(manager.id, "PHONE", row.phone, "chat-export");
    if (row.email) await upsertAlias(manager.id, "EMAIL", row.email, "chat-export");
    // Exact chat-export name spellings (incl. misspellings) so name-based
    // resolution works when a phone is ever missing.
    for (const cn of row.chatNames ?? []) await upsertAlias(manager.id, "FULL_NAME", cn, "chat-export", 0.9);

    // team-name aliases from every season this manager fielded a team
    const teams = await prisma.fantasyTeam.findMany({ where: { managerId: manager.id }, select: { teamName: true } });
    for (const t of teams) await upsertAlias(manager.id, "TEAM_NAME", t.teamName, "sleeper", 0.9);

    // 4) chat identity map (phone -> manager) so imports auto-resolve
    if (row.phone) {
      await prisma.chatIdentityMap.upsert({
        where: { rawIdentifier: row.phone },
        create: { rawIdentifier: row.phone, managerId: manager.id },
        update: { managerId: manager.id },
      });
    }

    // 5) MediaAsset(PROFILE): approved for confident, pending for flagged
    if (dims.bytes > 0) {
      const existing = await prisma.mediaAsset.findFirst({ where: { originalFilename: row.photoFile, category: "PROFILE" } });
      const data = {
        kind: "image",
        originalFilename: row.photoFile,
        url: publicUrl,
        width: dims.width,
        height: dims.height,
        fileSizeBytes: dims.bytes,
        category: "PROFILE" as const,
        managerId: manager.id,
        approvalStatus: (row.photoConfident ? "APPROVED" : "PENDING") as "APPROVED" | "PENDING",
        isPublished: row.photoConfident,
        notes: row.photoConfident ? null : "Filename maps to this manager, but the image's embedded handle conflicts — confirm the photo actually depicts this manager before publishing.",
      };
      if (existing) await prisma.mediaAsset.update({ where: { id: existing.id }, data });
      else await prisma.mediaAsset.create({ data });
    }

    console.log(
      `✓ ${row.fullName} (${manager.id}) photo=${row.photoConfident ? publicUrl : "PENDING review"} ${dims.bytes ? `[${(dims.bytes / 1024).toFixed(0)}kb]` : ""}`,
    );
  }

  console.log("\nDone. Managers updated with real names, aliases, phone map, and profile media.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
