import "dotenv/config";
import { prisma } from "@/lib/db";
import { groupConversations, type GroupableMessage } from "@/server/lore/conversation-grouping";
import { extractKnowledgeFromConversation } from "@/server/ai/services/knowledge-extraction";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";

/**
 * League-knowledge extraction over imported chat messages.
 *
 *   npx tsx scripts/lore/extract-knowledge.ts [--limit N]
 *
 * Groups messages into conversations, asks the AI to propose durable knowledge
 * (traits, rivalries, jokes, quotes, events) with supporting message IDs, and
 * saves each proposal as PENDING + PRIVATE LeagueKnowledge for admin review.
 * Requires OPENAI_API_KEY — without it the extractor returns nothing (so no
 * placeholder junk is written). Run AFTER importing chat pages + identity
 * matching. Nothing here is ever public until an admin approves + marks it
 * PUBLIC_SAFE.
 */

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : undefined;

  const messages = await prisma.chatMessage.findMany({
    where: { text: { not: null }, deletedAt: null },
    orderBy: { timestamp: "asc" },
    select: {
      id: true, timestamp: true, text: true, sourcePage: true,
      linkedManagerId: true,
      linkedManager: { select: { displayName: true } },
      participant: { select: { rawIdentifier: true } },
    },
  });
  if (messages.length === 0) {
    console.log("No imported chat messages found. Run scripts/chat-import/cli.ts first.");
    return;
  }

  const groupable: GroupableMessage[] = messages.map((m) => ({
    id: m.id,
    timestampMs: m.timestamp.getTime(),
    managerId: m.linkedManagerId,
    senderLabel: m.linkedManager?.displayName ?? m.participant.rawIdentifier,
    text: m.text ?? "",
    sourcePage: m.sourcePage,
  }));

  let conversations = groupConversations(groupable);
  if (limit) conversations = conversations.slice(0, limit);
  console.log(`Grouped ${messages.length} messages into ${conversations.length} conversations.`);

  // Resolve manager names -> ids via aliases (for linking proposals to managers).
  const aliases = await prisma.managerAlias.findMany({ where: { aliasType: { in: ["FULL_NAME", "FIRST_NAME"] } } });
  const managerByName = new Map<string, string>();
  for (const a of aliases) managerByName.set(a.value.toLowerCase(), a.managerId);

  const safeguards = await getContentSafeguards();
  let created = 0;
  let mockSeen = false;

  for (const conv of conversations) {
    const { proposals, isMock } = await extractKnowledgeFromConversation(conv, safeguards);
    if (isMock) { mockSeen = true; break; }
    for (const p of proposals) {
      const managerIds = [
        ...new Set(
          [
            ...conv.participantManagerIds,
            ...p.managerNames.map((n) => managerByName.get(n.toLowerCase())).filter((x): x is string => !!x),
          ],
        ),
      ];
      await prisma.leagueKnowledge.create({
        data: {
          knowledgeType: p.knowledgeType,
          title: p.title,
          body: p.body,
          confidence: p.confidence,
          approvalStatus: "PENDING",
          privacyStatus: p.privacyStatus,
          managers: { create: managerIds.map((managerId) => ({ managerId })) },
          evidence: { create: p.evidenceMessageIds.slice(0, 40).map((chatMessageId) => ({ chatMessageId })) },
        },
      });
      created++;
    }
    console.log(`  conv #${conv.index} (${conv.messageCount} msgs): +${proposals.length} proposals`);
  }

  if (mockSeen) {
    console.log("\nNo OPENAI_API_KEY configured — extraction produced nothing (by design). Set the key and re-run.");
  } else {
    console.log(`\nDone. Created ${created} PENDING/PRIVATE knowledge proposals for admin review.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
