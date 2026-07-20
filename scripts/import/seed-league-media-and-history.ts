import "dotenv/config";
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import type { MediaCategory, HistorySectionType } from "@/generated/prisma/client";

/**
 * Seeds (idempotently):
 *  - League pictures -> optimized public/league/*.webp + MediaAsset records.
 *    Every one shows identifiable people, so all import as PENDING + unpublished
 *    with a suggested category; nothing is shown publicly until an admin approves.
 *  - Commissioner history (2015-2023) -> LeagueHistorySection rows. The narrative
 *    is APPROVED (commissioner-authored); ambiguous claims become a PENDING
 *    "needs review" section. Champion->manager links are NOT auto-created
 *    (mostly ambiguous team-names); verified Sleeper stats own 2023+.
 */

const SRC = "C:\\Users\\antho\\Downloads\\wetransfer_fantasy-football_2026-07-19_2334";
const LEAGUE_PIC_DIR = join(SRC, "Fantasy League Pictures");
const OUT_DIR = join(process.cwd(), "public", "league");
const CATALOG = join(process.cwd(), "private", "extracts", "image-catalog.json");
const HISTORY = join(process.cwd(), "private", "extracts", "league-history-transcription.json");

// Suggested categories per file (people-bearing => still PENDING/unpublished).
const CATEGORY_HINT: Record<string, MediaCategory> = {
  "Home Screen Background.jpeg": "HOMEPAGE_HERO",
  "IMG_1300.jpeg": "EVENT", // "First Annual Rat Trap Flag Football Game" poster
  "IMG_0881.jpeg": "BACKGROUND",
  "IMG_0055.jpeg": "BACKGROUND",
  "IMG_1296.jpeg": "HISTORY",
  "IMG_1297.jpeg": "HISTORY",
  "IMG_1298.jpeg": "HISTORY",
  "IMG_1299.jpeg": "HISTORY",
};

function slugFile(file: string): string {
  return file.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function importLeaguePictures() {
  if (!existsSync(LEAGUE_PIC_DIR)) { console.warn("! league picture folder missing"); return; }
  mkdirSync(OUT_DIR, { recursive: true });
  const catalog: { leaguePictures?: { file: string; description?: string; notes?: string }[] } =
    existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, "utf8")) : {};
  const notesByFile = new Map((catalog.leaguePictures ?? []).map((p) => [p.file, p.description ?? p.notes ?? ""]));

  const { readdirSync } = await import("node:fs");
  const files = readdirSync(LEAGUE_PIC_DIR).filter((f) => /\.(jpe?g|png|heic)$/i.test(f));
  for (const file of files) {
    const buf = readFileSync(join(LEAGUE_PIC_DIR, file));
    // Cap at 1600px wide, webp — big enough for a hero, small enough to serve.
    const out = await sharp(buf).rotate().resize(1600, 1600, { fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    const outName = `${slugFile(file)}.webp`;
    writeFileSync(join(OUT_DIR, outName), out);
    const meta = await sharp(out).metadata();
    const url = `/league/${outName}`;
    const category = CATEGORY_HINT[file] ?? "UNCERTAIN";

    const existing = await prisma.mediaAsset.findFirst({ where: { originalFilename: file, category: { not: "PROFILE" } } });
    const data = {
      kind: "image",
      originalFilename: file,
      url,
      width: meta.width ?? null,
      height: meta.height ?? null,
      fileSizeBytes: out.length,
      category,
      approvalStatus: "PENDING" as const,
      isPublished: false, // shows publicly only after admin approves + publishes
      notes: `Contains identifiable people — review before publishing. ${notesByFile.get(file) ?? ""}`.trim(),
    };
    if (existing) await prisma.mediaAsset.update({ where: { id: existing.id }, data });
    else await prisma.mediaAsset.create({ data });
    console.log(`✓ league pic ${file} -> ${url} [${(out.length / 1024).toFixed(0)}kb] cat=${category} (PENDING)`);
  }
}

interface HistoryYear {
  year: number;
  rawText: string;
  facts: Record<string, unknown>;
  ambiguities: string[];
}

async function importHistory() {
  if (!existsSync(HISTORY)) { console.warn("! history transcription missing"); return; }
  const years: HistoryYear[] = JSON.parse(readFileSync(HISTORY, "utf8"));
  const seasons = await prisma.season.findMany({ select: { id: true, year: true } });
  const seasonByYear = new Map(seasons.map((s) => [s.year, s.id]));

  for (const y of years) {
    const seasonId = seasonByYear.get(y.year) ?? null;
    // Narrative summary — authoritative commissioner text => APPROVED.
    const title = `${y.year} Season`;
    const existing = await prisma.leagueHistorySection.findFirst({
      where: { year: y.year, sectionType: "SEASON_SUMMARY", title },
    });
    const body = y.rawText.trim();
    const data = {
      year: y.year,
      seasonId,
      sectionType: "SEASON_SUMMARY" as HistorySectionType,
      title,
      body,
      sourceRef: `League History Details/${y.year}.jpeg`,
      approvalStatus: "APPROVED" as const,
      sensitivity: "NONE" as const,
      sortOrder: y.year,
    };
    if (existing) await prisma.leagueHistorySection.update({ where: { id: existing.id }, data });
    else await prisma.leagueHistorySection.create({ data });

    // Ambiguities -> a PENDING review section so admins can resolve names/claims.
    if (y.ambiguities?.length) {
      const revTitle = `${y.year} — needs review`;
      const revBody = y.ambiguities.map((a) => `• ${a}`).join("\n");
      const revExisting = await prisma.leagueHistorySection.findFirst({ where: { year: y.year, sectionType: "OTHER", title: revTitle } });
      const revData = {
        year: y.year, seasonId, sectionType: "OTHER" as HistorySectionType, title: revTitle,
        body: revBody, sourceRef: `League History Details/${y.year}.jpeg`,
        approvalStatus: "PENDING" as const, sensitivity: "NONE" as const, sortOrder: y.year * 10 + 1,
      };
      if (revExisting) await prisma.leagueHistorySection.update({ where: { id: revExisting.id }, data: revData });
      else await prisma.leagueHistorySection.create({ data: revData });
    }
    console.log(`✓ history ${y.year}: ${body.length} chars, ${y.ambiguities?.length ?? 0} review items`);
  }
}

async function main() {
  await importLeaguePictures();
  await importHistory();
  console.log("\nDone. League media (PENDING) + commissioner history imported.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
