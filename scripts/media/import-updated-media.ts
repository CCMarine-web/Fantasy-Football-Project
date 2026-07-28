import "../lib/load-env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { ApprovalStatus, MediaCategory } from "@/generated/prisma/client";

/**
 * Imports the newly supplied media: updated manager portraits, the champion's
 * trophy photograph, and the punishment pictures.
 *
 *   npx tsx scripts/media/import-updated-media.ts --dry-run
 *   npx tsx scripts/media/import-updated-media.ts
 *   npx tsx scripts/media/import-updated-media.ts --source "C:\\path\\to\\Downloads"
 *
 * ── Matching rules ────────────────────────────────────────────────────────
 * Portraits are matched by filename against manager display names and their
 * recorded aliases, after stripping parenthetical nicknames — "Patrick Schwing
 * (The Rat).jpg" is Patrick Schwing. A file is only accepted when it resolves
 * to EXACTLY ONE manager; "Ethan.jpeg" is allowed because the league has one
 * Ethan, and "Michael Barkemeir.jpg" resolves by close surname match while
 * "Michael" alone would not, because there are two.
 *
 * Punishment photographs carry no identifying information in their filenames
 * (IMG_1364.jpg and similar) and there are no punishment records to attach
 * them to, so they are NOT guessed at. They are imported as PENDING media in
 * the admin review queue, where a human can assign the year and manager.
 *
 * ── Optimisation ──────────────────────────────────────────────────────────
 * Portraits become 512x512 WebP at quality 82 — the existing convention on
 * disk — cropped to the face using sharp's attention strategy rather than a
 * centre crop, which decapitates people in group shots. The hero image keeps
 * its aspect ratio at 1600px wide.
 */

const DEFAULT_SOURCE = "C:\\Users\\antho\\Downloads";
const PORTRAIT_DIR = "Updated Profile Pics";
const PUNISHMENT_DIR = "Punishment pictures";
const HERO_PREFIX = "Home Page Champ Image";

const PORTRAIT_OUT = join(process.cwd(), "public", "managers");
const LEAGUE_OUT = join(process.cwd(), "public", "league");
const PUNISHMENT_OUT = join(process.cwd(), "public", "punishments");

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Levenshtein distance, used only to tolerate a misspelled surname. */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

interface Candidate {
  id: string;
  displayName: string;
  slug: string;
  names: string[];
}

/**
 * Resolves a filename to exactly one manager, or returns why it could not.
 * Ambiguity is always an error — never a coin flip.
 */
function resolveManager(fileLabel: string, candidates: Candidate[]): { manager?: Candidate; reason?: string } {
  // Drop parenthetical nicknames: "Patrick Schwing (The Rat)" -> "Patrick Schwing".
  const cleaned = fileLabel.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  const target = normalize(cleaned);
  if (!target) return { reason: "filename has no usable name" };

  const exact = candidates.filter((c) => c.names.some((n) => normalize(n) === target));
  if (exact.length === 1) return { manager: exact[0] };
  if (exact.length > 1) {
    return { reason: `matches ${exact.length} managers exactly (${exact.map((c) => c.displayName).join(", ")})` };
  }

  // Single-token filenames ("Ethan") resolve only when one manager owns it.
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) {
    const token = normalize(tokens[0]);
    const byToken = candidates.filter((c) =>
      c.names.some((n) => n.split(/\s+/).some((part) => normalize(part) === token)),
    );
    if (byToken.length === 1) return { manager: byToken[0] };
    if (byToken.length > 1) {
      return { reason: `"${cleaned}" matches ${byToken.map((c) => c.displayName).join(", ")} — ambiguous` };
    }
    return { reason: `no manager matches "${cleaned}"` };
  }

  // Multi-token: require the first name to match and the surname to be close,
  // which accepts "Michael Barkemeir" without accepting "Michael Shea".
  const first = normalize(tokens[0]);
  const last = normalize(tokens[tokens.length - 1]);
  const scored: { c: Candidate; dist: number }[] = [];
  for (const c of candidates) {
    for (const name of c.names) {
      const parts = name.split(/\s+/).filter(Boolean);
      if (parts.length < 2) continue;
      const nFirst = normalize(parts[0]);
      const nLast = normalize(parts[parts.length - 1]);
      const firstDist = editDistance(first, nFirst);
      const lastDist = editDistance(last, nLast);
      if (firstDist <= 1 && lastDist <= 3) scored.push({ c, dist: firstDist + lastDist });
    }
  }
  if (scored.length === 0) return { reason: `no manager matches "${cleaned}"` };
  scored.sort((x, y) => x.dist - y.dist);
  const best = scored[0].dist;
  const winners = new Set(scored.filter((s) => s.dist === best).map((s) => s.c.id));
  if (winners.size > 1) {
    return { reason: `"${cleaned}" is ambiguous between ${[...winners].length} managers` };
  }
  return { manager: scored[0].c };
}

function listImages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => IMAGE_EXTENSIONS.has(extname(f).toLowerCase()))
    .sort();
}

function sha(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const sourceIndex = args.indexOf("--source");
  const source = sourceIndex >= 0 && args[sourceIndex + 1] ? args[sourceIndex + 1] : DEFAULT_SOURCE;

  console.log(`=== updated media import ===${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`source: ${source}`);

  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, aliases: { select: { value: true, aliasType: true } } },
  });
  const candidates: Candidate[] = managers.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    slug: m.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    names: [
      m.displayName,
      ...m.aliases.filter((a) => a.aliasType === "FULL_NAME" || a.aliasType === "FIRST_NAME").map((a) => a.value),
    ],
  }));

  // ── 1. Manager portraits ────────────────────────────────────────────────
  const portraitDir = join(source, PORTRAIT_DIR);
  const portraits = listImages(portraitDir);
  console.log(`\n--- portraits (${portraits.length} file(s)) ---`);
  const unmatchedPortraits: string[] = [];
  let portraitsWritten = 0;

  if (!dryRun) mkdirSync(PORTRAIT_OUT, { recursive: true });

  for (const file of portraits) {
    const label = basename(file, extname(file));
    const { manager, reason } = resolveManager(label, candidates);
    if (!manager) {
      unmatchedPortraits.push(`${file}: ${reason}`);
      console.log(`  SKIP  ${file.padEnd(34)} ${reason}`);
      continue;
    }

    const outName = `${manager.slug}.webp`;
    const outPath = join(PORTRAIT_OUT, outName);
    if (dryRun) {
      console.log(`  would write ${file.padEnd(34)} -> ${manager.displayName} (/managers/${outName})`);
      continue;
    }

    const input = readFileSync(join(portraitDir, file));
    const output = await sharp(input)
      .rotate() // honour EXIF orientation before cropping
      .resize(512, 512, { fit: "cover", position: sharp.strategy.attention })
      .webp({ quality: 82 })
      .toBuffer();
    writeFileSync(outPath, output);

    const before = (input.length / 1024).toFixed(0);
    const after = (output.length / 1024).toFixed(0);
    console.log(`  ${file.padEnd(34)} -> ${manager.displayName.padEnd(20)} /managers/${outName}  ${before}KB -> ${after}KB`);

    // The DB already points at this path for every manager, so no row changes.
    // Refresh the MediaAsset record so the admin gallery reflects the new file.
    await prisma.mediaAsset.updateMany({
      where: { managerId: manager.id, category: "PROFILE" },
      data: { url: `/managers/${outName}`, updatedAt: new Date() },
    });
    portraitsWritten++;
  }

  // ── 2. Champion hero image ──────────────────────────────────────────────
  const heroFile = listImages(source).find((f) => f.toLowerCase().startsWith(HERO_PREFIX.toLowerCase()));
  console.log(`\n--- champion hero ---`);
  let heroPath: string | null = null;
  if (!heroFile) {
    console.log(`  none found (expected a file starting "${HERO_PREFIX}")`);
  } else if (dryRun) {
    console.log(`  would write ${heroFile} -> /league/champion-hero.webp`);
  } else {
    mkdirSync(LEAGUE_OUT, { recursive: true });
    const input = readFileSync(join(source, heroFile));
    const output = await sharp(input)
      .rotate()
      .resize(1600, undefined, { withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
    heroPath = "/league/champion-hero.webp";
    writeFileSync(join(LEAGUE_OUT, "champion-hero.webp"), output);
    const meta = await sharp(output).metadata();
    console.log(
      `  ${heroFile} -> ${heroPath}  ${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB  ${meta.width}x${meta.height}`,
    );

    /*
     * Recorded as a CHAMPIONSHIP media asset against the manager rather than
     * hardcoded into the homepage. The belt looks up a published championship
     * photo for whoever currently holds the title, so next year's champion only
     * needs their picture uploaded — no code change.
     *
     * The manager is taken from the filename, which names them explicitly, and
     * cross-checked against the recorded champion below. Unlike a portrait,
     * where a parenthetical is a nickname to discard, the hero filename keeps
     * the name INSIDE the brackets — "Home Page Champ Image (Current Champ
     * Michael Shea)" — so the bracketed text is what gets resolved, minus the
     * descriptive words around it.
     */
    const bracketed = heroFile.match(/\(([^)]*)\)/)?.[1] ?? "";
    const heroLabel = bracketed
      .replace(/\b(current|reigning|defending|champ|champion|winner)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const named = heroLabel ? resolveManager(heroLabel, candidates).manager : undefined;
    const reigning = await prisma.championship.findFirst({
      orderBy: { season: { year: "desc" } },
      select: { championManagerId: true, championManager: { select: { displayName: true } }, season: { select: { year: true } } },
    });

    if (!named) {
      console.log(
        `  WARNING: "${heroFile}" names no manager I can resolve, so the photo is not attached to anyone.`,
      );
    } else if (reigning && named.id !== reigning.championManagerId) {
      console.log(
        `  WARNING: filename says ${named.displayName} but the ${reigning.season.year} champion on record is ${reigning.championManager.displayName}. Not attached — resolve the conflict first.`,
      );
    } else {
      const existing = await prisma.mediaAsset.findFirst({ where: { url: heroPath }, select: { id: true } });
      const data = {
        kind: "image",
        originalFilename: heroFile,
        url: heroPath,
        width: meta.width ?? null,
        height: meta.height ?? null,
        fileSizeBytes: output.length,
        category: MediaCategory.CHAMPIONSHIP,
        approvalStatus: ApprovalStatus.APPROVED,
        isPublished: true,
        managerId: named.id,
        notes: `Championship trophy photograph for ${named.displayName}. Shown on the homepage belt while they hold the title.`,
      };
      if (existing) await prisma.mediaAsset.update({ where: { id: existing.id }, data });
      else await prisma.mediaAsset.create({ data });
      console.log(`  attached to ${named.displayName} as the reigning champion's trophy photo`);
    }
  }

  // ── 3. Punishment photographs ───────────────────────────────────────────
  //
  // These filenames carry no year, manager or event, and there are no
  // punishment records to attach them to. Guessing would put a real person's
  // face against a punishment they may not have served, so every one goes to
  // the admin review queue instead.
  const punishmentDir = join(source, PUNISHMENT_DIR);
  const punishments = listImages(punishmentDir);
  console.log(`\n--- punishment photographs (${punishments.length} file(s)) ---`);
  let punishmentsQueued = 0;

  if (!dryRun && punishments.length > 0) mkdirSync(PUNISHMENT_OUT, { recursive: true });

  for (const file of punishments) {
    const label = basename(file, extname(file));
    const { manager } = resolveManager(label, candidates);
    const identifiable = !!manager;

    if (dryRun) {
      console.log(
        `  would queue ${file.padEnd(20)} ${identifiable ? `-> ${manager!.displayName}` : "-> ADMIN REVIEW (filename identifies nobody)"}`,
      );
      continue;
    }

    const input = readFileSync(join(punishmentDir, file));
    const output = await sharp(input).rotate().resize(1400, undefined, { withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    const outName = `punishment-${sha(output)}.webp`;
    writeFileSync(join(PUNISHMENT_OUT, outName), output);
    const url = `/punishments/${outName}`;
    const meta = await sharp(output).metadata();

    const existing = await prisma.mediaAsset.findFirst({ where: { url }, select: { id: true } });
    const data = {
      kind: "image",
      originalFilename: file,
      url,
      width: meta.width ?? null,
      height: meta.height ?? null,
      fileSizeBytes: output.length,
      category: MediaCategory.PUNISHMENT,
      // PENDING and unpublished on purpose: nothing about the file says who or
      // when, and putting a real person's face against the wrong punishment is
      // worse than showing no photo at all.
      approvalStatus: ApprovalStatus.PENDING,
      isPublished: false,
      managerId: manager?.id ?? null,
      notes: `Imported from "Punishment pictures/${file}". The filename identifies no manager, season or punishment — assign both before publishing.`,
    };
    if (existing) await prisma.mediaAsset.update({ where: { id: existing.id }, data });
    else await prisma.mediaAsset.create({ data });

    console.log(`  ${file.padEnd(20)} -> ${url}  (queued for admin review)`);
    punishmentsQueued++;
  }

  console.log(`\n=== summary ===`);
  console.log(`portraits written:        ${dryRun ? "(dry run)" : portraitsWritten}/${portraits.length}`);
  console.log(`champion hero:            ${dryRun ? "(dry run)" : heroPath ? heroPath : "not imported"}`);
  console.log(`punishment photos queued: ${dryRun ? "(dry run)" : punishmentsQueued}/${punishments.length}`);
  if (unmatchedPortraits.length > 0) {
    console.log(`\nportraits needing manual attention:`);
    for (const line of unmatchedPortraits) console.log(`  ${line}`);
  }
  if (punishments.length > 0) {
    console.log(`\nAll punishment photographs require a human to assign year + manager at /admin/media.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
