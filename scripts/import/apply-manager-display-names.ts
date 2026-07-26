import "../lib/load-env";
import { prisma } from "@/lib/db";

/**
 * Sets each manager's displayName to their real full name (from the FULL_NAME
 * alias the identity import created), and repairs avatarUrl values that were
 * stored as bare Sleeper avatar ids instead of URLs.
 *
 *   npx tsx scripts/import/apply-manager-display-names.ts --dry-run
 *   npx tsx scripts/import/apply-manager-display-names.ts
 *
 * Why: the Sleeper sync used to overwrite displayName with the Sleeper handle
 * on every run, so the whole site (and every AI blurb) referred to people as
 * "gdetillier8" instead of "Gavin Detillier". The sync no longer touches
 * displayName; this backfills the names it previously clobbered.
 */

const SLEEPER_AVATAR_CDN = "https://sleepercdn.com/avatars/thumbs/";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      aliases: { where: { aliasType: "FULL_NAME" }, select: { value: true } },
    },
    orderBy: { displayName: "asc" },
  });

  let renamed = 0;
  let avatarsFixed = 0;

  for (const m of managers) {
    const fullName = m.aliases[0]?.value?.trim();
    const data: { displayName?: string; avatarUrl?: string } = {};

    if (fullName && fullName !== m.displayName) {
      data.displayName = fullName;
      console.log(`  rename: ${m.displayName} -> ${fullName}`);
      renamed++;
    } else if (!fullName) {
      console.log(`  skip (no FULL_NAME alias): ${m.displayName}`);
    }

    // A bare avatar id has no scheme and no leading slash — unusable as a src.
    if (m.avatarUrl && !/^(https?:)?\/\//.test(m.avatarUrl) && !m.avatarUrl.startsWith("/")) {
      data.avatarUrl = `${SLEEPER_AVATAR_CDN}${m.avatarUrl}`;
      console.log(`  avatar: ${m.displayName} -> CDN URL`);
      avatarsFixed++;
    }

    if (!dryRun && Object.keys(data).length > 0) {
      await prisma.manager.update({ where: { id: m.id }, data });
    }
  }

  console.log(dryRun ? "\n--dry-run: no changes written." : `\nRenamed ${renamed}; fixed ${avatarsFixed} avatar URL(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
