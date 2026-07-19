// The ONLY sanctioned way AI generation code should ever read chat history.
//
// Raw chat archives must NEVER be sent wholesale to an AI provider. This
// function only ever returns messages that are already human-reviewed
// (approvalStatus: APPROVED) and cleared of sensitive content
// (sensitivityStatus: NONE), and is always scoped narrowly by manager,
// season, week, and/or tag — never "dump everything". Anything under
// src/server/ai/ that wants chat-derived flavor text for a prompt must go
// through this function, not a direct Prisma query against ChatMessage.

import { prisma } from "@/lib/db";
import { ApprovalStatus, SensitivityStatus } from "@/generated/prisma/client";

const DEFAULT_LIMIT = 20;

export interface ApprovedContextFilter {
  managerId?: string;
  seasonYear?: number;
  week?: number;
  tags?: string[];
  /** Max messages to return. Defaults to 20; always capped, never unbounded. */
  limit?: number;
}

export interface ApprovedContextMessage {
  text: string;
  managerId: string | null;
  timestamp: Date;
}

export async function getApprovedContextForGeneration(
  filter: ApprovedContextFilter = {}
): Promise<ApprovedContextMessage[]> {
  const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, DEFAULT_LIMIT * 5) : DEFAULT_LIMIT;

  const rows = await prisma.chatMessage.findMany({
    where: {
      approvalStatus: ApprovalStatus.APPROVED,
      sensitivityStatus: SensitivityStatus.NONE,
      deletedAt: null,
      text: { not: null },
      ...(filter.managerId ? { linkedManagerId: filter.managerId } : {}),
      ...(filter.seasonYear !== undefined ? { linkedSeasonYear: filter.seasonYear } : {}),
      ...(filter.week !== undefined ? { linkedWeek: filter.week } : {}),
      ...(filter.tags && filter.tags.length > 0
        ? { tags: { some: { tag: { in: filter.tags } } } }
        : {}),
    },
    select: { text: true, linkedManagerId: true, timestamp: true },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  return rows
    .filter((row): row is typeof row & { text: string } => row.text !== null && row.text.length > 0)
    .map((row) => ({
      text: row.text,
      managerId: row.linkedManagerId,
      timestamp: row.timestamp,
    }));
}
