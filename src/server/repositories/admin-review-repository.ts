// Read-model queries for the admin "review newly-imported source data"
// dashboard. This file is QUERIES ONLY — mutations live in each route's
// actions.ts. It intentionally does not touch any existing repository.

import { prisma } from "@/lib/db";
import type {
  ApprovalStatus,
  MediaCategory,
  HistorySectionType,
  KnowledgeType,
  PrivacyStatus,
  SensitivityStatus,
  AliasType,
} from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export interface ManagerOption {
  id: string;
  displayName: string;
}

export async function listManagerOptions(): Promise<ManagerOption[]> {
  return prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true },
    orderBy: { displayName: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Media assets
// ---------------------------------------------------------------------------

export interface MediaAssetView {
  id: string;
  url: string;
  originalFilename: string;
  category: MediaCategory;
  managerId: string | null;
  managerName: string | null;
  approvalStatus: ApprovalStatus;
  isPublished: boolean;
  notes: string | null;
}

export async function listMediaAssets(): Promise<MediaAssetView[]> {
  const rows = await prisma.mediaAsset.findMany({
    include: { manager: { select: { displayName: true } } },
    orderBy: [{ createdAt: "desc" }, { sortOrder: "asc" }],
  });
  return rows.map((m) => ({
    id: m.id,
    url: m.url,
    originalFilename: m.originalFilename,
    category: m.category,
    managerId: m.managerId,
    managerName: m.manager?.displayName ?? null,
    approvalStatus: m.approvalStatus,
    isPublished: m.isPublished,
    notes: m.notes,
  }));
}

// ---------------------------------------------------------------------------
// League history sections
// ---------------------------------------------------------------------------

export interface HistorySectionView {
  id: string;
  year: number | null;
  sectionType: HistorySectionType;
  title: string;
  body: string;
  approvalStatus: ApprovalStatus;
  sensitivity: SensitivityStatus;
  managerName: string | null;
  sortOrder: number;
}

export async function listHistorySections(): Promise<HistorySectionView[]> {
  const rows = await prisma.leagueHistorySection.findMany({
    include: { manager: { select: { displayName: true } } },
    orderBy: [{ year: "asc" }, { sortOrder: "asc" }],
  });
  return rows.map((h) => ({
    id: h.id,
    year: h.year,
    sectionType: h.sectionType,
    title: h.title,
    body: h.body,
    approvalStatus: h.approvalStatus,
    sensitivity: h.sensitivity,
    managerName: h.manager?.displayName ?? null,
    sortOrder: h.sortOrder,
  }));
}

// ---------------------------------------------------------------------------
// Chat imports
// ---------------------------------------------------------------------------

export interface ChatImportRow {
  id: string;
  status: string;
  messageCount: number | null;
  originalFileName: string;
  createdAt: Date;
}

export interface ChatParticipantRow {
  id: string;
  rawIdentifier: string;
  linkedManagerId: string | null;
  linkedManagerName: string | null;
  messageCount: number;
}

export interface LatestImportDetail {
  importId: string;
  participants: ChatParticipantRow[];
  totalMessages: number;
  pendingMessages: number;
  approvedMessages: number;
  lowConfidenceMessages: number;
}

export async function listChatImports(): Promise<ChatImportRow[]> {
  const rows = await prisma.chatImport.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      messageCount: true,
      originalFileName: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    messageCount: r.messageCount,
    originalFileName: r.originalFileName,
    createdAt: r.createdAt,
  }));
}

/** Detail (participants + message stats) for the most recent import, if any. */
export async function getLatestChatImportDetail(): Promise<LatestImportDetail | null> {
  const latest = await prisma.chatImport.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) return null;

  const [participants, totalMessages, pendingMessages, approvedMessages, lowConfidenceMessages] =
    await Promise.all([
      prisma.chatParticipant.findMany({
        where: { chatImportId: latest.id },
        include: {
          linkedManager: { select: { displayName: true } },
          _count: { select: { messages: true } },
        },
        orderBy: { rawIdentifier: "asc" },
      }),
      prisma.chatMessage.count({ where: { chatImportId: latest.id } }),
      prisma.chatMessage.count({ where: { chatImportId: latest.id, approvalStatus: "PENDING" } }),
      prisma.chatMessage.count({ where: { chatImportId: latest.id, approvalStatus: "APPROVED" } }),
      prisma.chatMessage.count({ where: { chatImportId: latest.id, parseConfidence: { lt: 0.6 } } }),
    ]);

  return {
    importId: latest.id,
    participants: participants.map((p) => ({
      id: p.id,
      rawIdentifier: p.rawIdentifier,
      linkedManagerId: p.linkedManagerId,
      linkedManagerName: p.linkedManager?.displayName ?? null,
      messageCount: p._count.messages,
    })),
    totalMessages,
    pendingMessages,
    approvedMessages,
    lowConfidenceMessages,
  };
}

// ---------------------------------------------------------------------------
// League knowledge
// ---------------------------------------------------------------------------

export interface KnowledgeEvidenceView {
  id: string;
  note: string | null;
  chatMessageText: string | null;
}

export interface KnowledgeView {
  id: string;
  knowledgeType: KnowledgeType;
  title: string;
  body: string;
  confidence: number;
  approvalStatus: ApprovalStatus;
  privacyStatus: PrivacyStatus;
  sensitivity: SensitivityStatus;
  managerNames: string[];
  evidenceCount: number;
  evidence: KnowledgeEvidenceView[];
}

export async function listLeagueKnowledge(): Promise<KnowledgeView[]> {
  const rows = await prisma.leagueKnowledge.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      managers: { include: { manager: { select: { displayName: true } } } },
      evidence: {
        include: { chatMessage: { select: { text: true } } },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { evidence: true } },
    },
  });
  return rows.map((k) => ({
    id: k.id,
    knowledgeType: k.knowledgeType,
    title: k.title,
    body: k.body,
    confidence: k.confidence,
    approvalStatus: k.approvalStatus,
    privacyStatus: k.privacyStatus,
    sensitivity: k.sensitivity,
    managerNames: k.managers.map((m) => m.manager.displayName),
    evidenceCount: k._count.evidence,
    evidence: k.evidence.map((e) => ({
      id: e.id,
      note: e.note,
      chatMessageText: e.chatMessage?.text ?? null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// Manager identity overview
// ---------------------------------------------------------------------------

export interface ManagerAliasView {
  aliasType: AliasType;
  value: string;
}

export interface ManagerIdentityView {
  id: string;
  displayName: string;
  photoUrl: string | null;
  aliases: ManagerAliasView[];
  identityRawIdentifiers: string[];
}

export async function listManagerIdentityOverview(): Promise<ManagerIdentityView[]> {
  const rows = await prisma.manager.findMany({
    where: { deletedAt: null },
    orderBy: { displayName: "asc" },
    select: {
      id: true,
      displayName: true,
      photoUrl: true,
      aliases: {
        select: { aliasType: true, value: true },
        orderBy: [{ aliasType: "asc" }, { value: "asc" }],
      },
      chatIdentityMaps: { select: { rawIdentifier: true }, orderBy: { rawIdentifier: "asc" } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    photoUrl: m.photoUrl,
    aliases: m.aliases.map((a) => ({ aliasType: a.aliasType, value: a.value })),
    identityRawIdentifiers: m.chatIdentityMaps.map((c) => c.rawIdentifier),
  }));
}
