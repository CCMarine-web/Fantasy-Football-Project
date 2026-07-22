// Consolidated AI research packets. After the chat-archive consolidation runs,
// generation code can pull a compact, bounded "research packet" per manager and
// a league-wide voice-guidance block, assembled from the PRIVATE consolidated
// artifacts (communication profiles, league profile, relationships, approved
// knowledge). This is read-only assembly — no AI calls, no raw chat dumps.
//
// Privacy: the packet is for INTERNAL/admin generation context (tone/voice),
// never rendered to the public. Fact-level fields still prefer verified data.

import { prisma } from "@/lib/db";

export interface ManagerResearchPacket {
  managerId: string;
  managerName: string;
  /** Saved performance summary (verified stats + approved knowledge), if any. */
  performanceSummary: string | null;
  /** Private communication-style tagline, if a profile exists. */
  styleSummary: string | null;
  /** Full private communication profile, if a profile exists. */
  commProfile: string | null;
  /** Top approved, public-safe knowledge titles about this manager. */
  knowledgeTitles: string[];
  /** Relationship one-liners with other managers (private tone context). */
  relationships: { otherName: string; type: string; summary: string }[];
}

export async function buildManagerResearchPacket(managerId: string): Promise<ManagerResearchPacket | null> {
  const manager = await prisma.manager.findUnique({
    where: { id: managerId },
    select: {
      id: true,
      displayName: true,
      performanceSummary: { select: { summary: true } },
      commProfile: { select: { profile: true, styleSummary: true } },
    },
  });
  if (!manager) return null;

  const [knowledge, relsA, relsB] = await Promise.all([
    prisma.leagueKnowledge.findMany({
      where: { approvalStatus: "APPROVED", privacyStatus: "PUBLIC_SAFE", managers: { some: { managerId } } },
      select: { title: true },
      take: 8,
    }),
    prisma.managerRelationship.findMany({
      where: { managerAId: managerId },
      select: { relationshipType: true, summary: true, managerB: { select: { displayName: true } } },
    }),
    prisma.managerRelationship.findMany({
      where: { managerBId: managerId },
      select: { relationshipType: true, summary: true, managerA: { select: { displayName: true } } },
    }),
  ]);

  const relationships = [
    ...relsA.map((r) => ({ otherName: r.managerB.displayName, type: r.relationshipType, summary: r.summary })),
    ...relsB.map((r) => ({ otherName: r.managerA.displayName, type: r.relationshipType, summary: r.summary })),
  ];

  return {
    managerId: manager.id,
    managerName: manager.displayName,
    performanceSummary: manager.performanceSummary?.summary ?? null,
    styleSummary: manager.commProfile?.styleSummary ?? null,
    commProfile: manager.commProfile?.profile ?? null,
    knowledgeTitles: knowledge.map((k) => k.title),
    relationships,
  };
}

/**
 * League-wide voice guidance as a compact string for prompt injection. Empty
 * string when no LeagueProfile has been generated yet, so callers can append
 * unconditionally.
 */
export async function buildLeagueVoiceGuidance(): Promise<string> {
  const profile = await prisma.leagueProfile.findFirst({
    select: { humorStyle: true, communicationStyle: true, dynamics: true, traditions: true, historicalContext: true },
  });
  if (!profile) return "";
  const parts: string[] = [];
  if (profile.humorStyle) parts.push(`Humor: ${profile.humorStyle}`);
  if (profile.communicationStyle) parts.push(`Communication: ${profile.communicationStyle}`);
  if (profile.dynamics) parts.push(`Dynamics: ${profile.dynamics}`);
  if (profile.traditions) parts.push(`Traditions: ${profile.traditions}`);
  if (profile.historicalContext) parts.push(`History: ${profile.historicalContext}`);
  if (parts.length === 0) return "";
  return `League voice guidance (match this tone):\n${parts.join("\n")}`;
}
