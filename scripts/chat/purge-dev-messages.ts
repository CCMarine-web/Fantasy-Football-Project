import "../lib/load-env";
import { prisma } from "@/lib/db";
import { loadReservedNames, normaliseName } from "@/server/chat/identity";

/**
 * Removes the development-era messages from the PUBLIC shoutbox.
 *
 *   npx tsx scripts/chat/purge-dev-messages.ts --dry-run
 *   npx tsx scripts/chat/purge-dev-messages.ts
 *
 * Two categories go, and nothing else:
 *
 *  1. IMPERSONATIONS — any message posted under a real manager's name, team
 *     name or alias before verification existed. Nobody could prove who they
 *     were when these were written, so none of them can be trusted, and one of
 *     them put a confession in a manager's mouth.
 *
 *  2. TEST POSTS — the handful of one-word smoke-test messages written while
 *     the feature was being built ("Hello World", "Yo", "Same"). They are
 *     matched by exact body text, listed below, so this cannot quietly widen
 *     into deleting real conversation.
 *
 * Everything else is left alone. Run with --dry-run first; it prints exactly
 * what would go.
 */

/** Exact bodies (case-insensitive, trimmed) recognised as build-time noise. */
const TEST_BODIES = new Set(
  ["hello world", "yo", "same", "yes chef!", "yes chef", "test", "testing", "yo what's up guys!"].map(
    (s) => s.toLowerCase(),
  ),
);

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const reserved = await loadReservedNames();

  const messages = await prisma.publicChatMessage.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      displayName: true,
      body: true,
      createdAt: true,
      verifiedManagerId: true,
    },
  });

  const doomed: { id: string; why: string; displayName: string; body: string }[] = [];
  for (const m of messages) {
    // A verified message is by definition not an impersonation.
    if (m.verifiedManagerId) continue;

    const owner = reserved.get(normaliseName(m.displayName));
    if (owner) {
      doomed.push({
        id: m.id,
        why: `impersonated ${owner.managerName} (${owner.source} name)`,
        displayName: m.displayName,
        body: m.body,
      });
      continue;
    }
    if (TEST_BODIES.has(m.body.trim().toLowerCase())) {
      doomed.push({ id: m.id, why: "build-time test post", displayName: m.displayName, body: m.body });
    }
  }

  console.log(`=== public chat purge ===${dryRun ? " (DRY RUN)" : ""}`);
  console.log(`${messages.length} message(s) on record; ${doomed.length} to remove.\n`);
  for (const d of doomed) {
    console.log(`  [${d.why}] ${d.displayName}: ${d.body.slice(0, 80)}`);
  }
  const kept = messages.length - doomed.length;
  console.log(`\n${kept} message(s) kept.`);

  if (dryRun || doomed.length === 0) {
    console.log(dryRun ? "\n--dry-run: nothing deleted." : "\nNothing to delete.");
    return;
  }

  const result = await prisma.publicChatMessage.deleteMany({
    where: { id: { in: doomed.map((d) => d.id) } },
  });
  console.log(`\nDeleted ${result.count} message(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
