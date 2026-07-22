import "dotenv/config";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { groupConversations, type Conversation, type GroupableMessage } from "@/server/lore/conversation-grouping";
import { getContentSafeguards } from "@/server/repositories/ai-config-repository";
import { buildManagerGameLog, regenerateManagerPerformanceSummary } from "@/server/repositories/manager-repository";
import { extractKnowledgeFromConversation } from "@/server/ai/services/knowledge-extraction";
import { generateManagerCommunicationProfile, type ManagerCommPacket } from "@/server/ai/services/manager-communication-profile";
import { generateRelationshipSummary, type RelationshipPacket } from "@/server/ai/services/relationship-summary";
import { generateLeagueCommunicationProfile, type LeagueProfilePacket } from "@/server/ai/services/league-communication-profile";
import { recordContentUsage } from "@/server/ai/content-memory";
import type { AIUsage } from "@/server/ai/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Full chat-archive consolidation — RESUMABLE, admin-only, local batch tool.
 * NEVER run against Vercel / a browser request.
 *
 *   npx tsx scripts/lore/consolidate-archive.ts --dry-run
 *   npx tsx scripts/lore/consolidate-archive.ts                 # run all passes, resume
 *   npx tsx scripts/lore/consolidate-archive.ts --pass extract --limit 50
 *   npx tsx scripts/lore/consolidate-archive.ts --fresh         # ignore checkpoint
 *
 * Passes (run in order; each is independently checkpointed + idempotent):
 *   1. extract           knowledge extraction per conversation      (extraction model)
 *   2. manager-profiles  private personality/communication profile   (synthesis model)
 *   3. relationships     rivalry/relationship summaries per pair      (synthesis model)
 *   4. league-profile    league-wide humor/dynamics/traditions/history(synthesis model)
 *   5. regenerate        regenerate saved content + wire content memory
 *
 * Requires OPENAI_API_KEY. Without it every AI call returns the mock provider;
 * the script detects that and aborts BEFORE writing anything, so a keyless run
 * is a safe no-op. Everything written is PENDING/PRIVATE and admin-only — no
 * public archive, quote library, or searchable messages are ever created.
 */

// --- Cost model (EDITABLE) --------------------------------------------------
// USD per 1,000,000 tokens. These are assumptions for reporting only — update
// them to the current OpenAI rate card. Real token counts come from the API.
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-5-mini": { in: 0.25, out: 2.0 },
  "gpt-5": { in: 1.25, out: 10.0 },
};
function priceFor(model: string): { in: number; out: number } {
  if (PRICES[model]) return PRICES[model];
  // Match a known prefix (API may return a dated variant like gpt-5-2025-xx).
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  return key ? PRICES[key] : { in: 0, out: 0 };
}

// --- Args -------------------------------------------------------------------
type PassName = "extract" | "manager-profiles" | "relationships" | "league-profile" | "regenerate";
const ALL_PASSES: PassName[] = ["extract", "manager-profiles", "relationships", "league-profile", "regenerate"];

interface Args {
  pass: PassName | "all";
  limit: number | null;
  dryRun: boolean;
  fresh: boolean;
  gapMinutes: number;
  maxMessages: number;
  extractModel: string | undefined;
  synthModel: string;
  minPairConvs: number;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (flag: string, def?: string) => {
    const i = a.indexOf(flag);
    return i >= 0 && a[i + 1] ? a[i + 1] : def;
  };
  const env = getEnv();
  const passArg = (get("--pass", "all") as PassName | "all");
  return {
    pass: passArg,
    limit: get("--limit") ? Number(get("--limit")) : null,
    dryRun: a.includes("--dry-run"),
    fresh: a.includes("--fresh"),
    gapMinutes: Number(get("--gap", "45")),
    maxMessages: Number(get("--max-msgs", "60")),
    extractModel: get("--extract-model") || undefined, // undefined => provider uses OPENAI_MODEL
    synthModel: get("--synth-model", env.OPENAI_SYNTHESIS_MODEL)!,
    minPairConvs: Number(get("--min-pair-convs", "3")),
  };
}

// --- Checkpoint -------------------------------------------------------------
const CHECKPOINT_DIR = join(process.cwd(), "scripts", "lore", ".checkpoints");
const CHECKPOINT_FILE = join(CHECKPOINT_DIR, "consolidate.json");

interface Checkpoint {
  passes: {
    extract: { doneConvKeys: string[] };
    "manager-profiles": { doneManagerIds: string[] };
    relationships: { donePairKeys: string[] };
    "league-profile": { done: boolean };
    regenerate: { doneManagerIds: string[] };
  };
  updatedAt: string;
}

function emptyCheckpoint(): Checkpoint {
  return {
    passes: {
      extract: { doneConvKeys: [] },
      "manager-profiles": { doneManagerIds: [] },
      relationships: { donePairKeys: [] },
      "league-profile": { done: false },
      regenerate: { doneManagerIds: [] },
    },
    updatedAt: new Date(0).toISOString(),
  };
}

function loadCheckpoint(fresh: boolean): Checkpoint {
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  if (!fresh && existsSync(CHECKPOINT_FILE)) {
    try {
      const cp = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")) as Checkpoint;
      // Shallow-merge with empty so new pass keys don't crash an old checkpoint.
      const base = emptyCheckpoint();
      return { passes: { ...base.passes, ...cp.passes }, updatedAt: cp.updatedAt };
    } catch {
      /* corrupt checkpoint — start fresh */
    }
  }
  return emptyCheckpoint();
}

function saveCheckpoint(cp: Checkpoint) {
  cp.updatedAt = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// --- Token / cost meter -----------------------------------------------------
class Meter {
  calls = 0;
  private byModel = new Map<string, { in: number; out: number; calls: number }>();
  estimatedCalls = 0;

  record(model: string, usage?: AIUsage) {
    this.calls++;
    const m = this.byModel.get(model) ?? { in: 0, out: 0, calls: 0 };
    m.calls++;
    if (usage) {
      m.in += usage.inputTokens;
      m.out += usage.outputTokens;
    } else {
      this.estimatedCalls++;
    }
    this.byModel.set(model, m);
  }

  report(): string {
    const lines: string[] = [];
    let totalUsd = 0;
    let totalIn = 0;
    let totalOut = 0;
    for (const [model, m] of this.byModel) {
      const p = priceFor(model);
      const usd = (m.in / 1e6) * p.in + (m.out / 1e6) * p.out;
      totalUsd += usd;
      totalIn += m.in;
      totalOut += m.out;
      lines.push(`  ${model}: ${m.calls} calls, ${m.in.toLocaleString()} in / ${m.out.toLocaleString()} out => $${usd.toFixed(4)}`);
    }
    lines.push(`  TOTAL: ${this.calls} calls, ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out => ~$${totalUsd.toFixed(2)} (prices are editable assumptions in the script)`);
    if (this.estimatedCalls) lines.push(`  note: ${this.estimatedCalls} call(s) returned no usage data.`);
    return lines.join("\n");
  }
}

// --- Shared helpers ---------------------------------------------------------
function convKey(conv: Conversation): string {
  return `${conv.messageIds[0]}:${conv.messageCount}`;
}
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}
function cleanLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

interface LoadedMessage {
  id: string;
  timestampMs: number;
  managerId: string | null;
  senderLabel: string;
  text: string;
  sourcePage: number | null;
}

async function loadMessages(): Promise<LoadedMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { text: { not: null }, deletedAt: null },
    orderBy: { timestamp: "asc" },
    select: {
      id: true, timestamp: true, text: true, sourcePage: true,
      linkedManagerId: true,
      linkedManager: { select: { displayName: true } },
      participant: { select: { rawIdentifier: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    timestampMs: m.timestamp.getTime(),
    managerId: m.linkedManagerId,
    senderLabel: m.linkedManager?.displayName ?? m.participant.rawIdentifier,
    text: m.text ?? "",
    sourcePage: m.sourcePage,
  }));
}

// ---------------------------------------------------------------------------
// Pass 1: knowledge extraction (per conversation)
// ---------------------------------------------------------------------------
async function passExtract(convs: Conversation[], cp: Checkpoint, args: Args, meter: Meter): Promise<{ aborted: boolean; created: number }> {
  const done = new Set(cp.passes.extract.doneConvKeys);
  const eligible = convs.filter((c) => c.transcript.length >= 80 && !done.has(convKey(c)));
  const todo = args.limit ? eligible.slice(0, args.limit) : eligible;
  console.log(`[extract] ${eligible.length} eligible conversation(s) remaining; processing ${todo.length}`);
  if (args.dryRun) return { aborted: false, created: 0 };

  const safeguards = await getContentSafeguards();
  const aliases = await prisma.managerAlias.findMany({ where: { aliasType: { in: ["FULL_NAME", "FIRST_NAME"] } } });
  const managerByName = new Map<string, string>();
  for (const a of aliases) managerByName.set(a.value.toLowerCase(), a.managerId);

  let created = 0;
  for (const conv of todo) {
    const { proposals, isMock, usage } = await extractKnowledgeFromConversation(conv, safeguards, { model: args.extractModel });
    if (isMock) {
      console.log("[extract] mock provider (no OPENAI_API_KEY) — aborting before any writes.");
      return { aborted: true, created };
    }
    meter.record(args.extractModel ?? getEnv().OPENAI_MODEL, usage);
    for (const p of proposals) {
      const managerIds = [
        ...new Set([
          ...conv.participantManagerIds,
          ...p.managerNames.map((n) => managerByName.get(n.toLowerCase())).filter((x): x is string => !!x),
        ]),
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
    cp.passes.extract.doneConvKeys.push(convKey(conv));
    if (meter.calls % 25 === 0) {
      saveCheckpoint(cp);
      console.log(`[extract] ${meter.calls} calls, +${created} proposals so far`);
    }
  }
  saveCheckpoint(cp);
  console.log(`[extract] done this run: +${created} PENDING/PRIVATE proposals`);
  return { aborted: false, created };
}

// ---------------------------------------------------------------------------
// Pass 2: per-manager communication profiles
// ---------------------------------------------------------------------------
async function passManagerProfiles(
  managers: { id: string; displayName: string }[],
  msgs: LoadedMessage[],
  cp: Checkpoint, args: Args, meter: Meter,
): Promise<{ aborted: boolean; created: number }> {
  const done = new Set(cp.passes["manager-profiles"].doneManagerIds);
  const todoAll = managers.filter((m) => !done.has(m.id));
  const todo = args.limit ? todoAll.slice(0, args.limit) : todoAll;
  console.log(`[manager-profiles] ${todoAll.length} remaining; processing ${todo.length}`);
  if (args.dryRun) return { aborted: false, created: 0 };

  const safeguards = await getContentSafeguards();
  const byManager = new Map<string, LoadedMessage[]>();
  for (const m of msgs) if (m.managerId) (byManager.get(m.managerId) ?? byManager.set(m.managerId, []).get(m.managerId)!).push(m);

  let created = 0;
  for (const mgr of todo) {
    const own = byManager.get(mgr.id) ?? [];
    const [knowledge, teams] = await Promise.all([
      prisma.leagueKnowledge.findMany({
        where: { managers: { some: { managerId: mgr.id } } },
        select: { id: true, knowledgeType: true, title: true, body: true },
        orderBy: { confidence: "desc" },
        take: 30,
      }),
      prisma.fantasyTeam.findMany({ where: { managerId: mgr.id, season: { status: "COMPLETE" } }, include: { season: true }, orderBy: { season: { year: "asc" } } }),
    ]);
    if (own.length === 0 && knowledge.length === 0) {
      cp.passes["manager-profiles"].doneManagerIds.push(mgr.id);
      console.log(`[manager-profiles] ${mgr.displayName}: no material — skipped`);
      continue;
    }
    const years = teams.map((t) => t.season.year);
    const wins = teams.reduce((s, t) => s + t.wins, 0);
    const losses = teams.reduce((s, t) => s + t.losses, 0);
    const ties = teams.reduce((s, t) => s + t.ties, 0);
    const champs = teams.filter((t) => t.isChampion).length;

    const packet: ManagerCommPacket = {
      managerName: mgr.displayName,
      yearsActive: years.length ? (years[0] === years.at(-1) ? `${years[0]}` : `${years[0]}–${years.at(-1)}`) : "—",
      careerRecord: `${wins}-${losses}${ties ? `-${ties}` : ""}`,
      championships: champs,
      knowledge: knowledge.map((k) => ({ type: k.knowledgeType, title: k.title, body: k.body })),
      messageSamples: sampleEvenly(own.map((m) => cleanLine(m.text)).filter((t) => t.length > 3), 120),
      totalMessages: own.length,
    };

    const result = await generateManagerCommunicationProfile(packet, safeguards, { model: args.synthModel });
    if (result.isMock) {
      console.log("[manager-profiles] mock provider — aborting before any writes.");
      return { aborted: true, created };
    }
    meter.record(result.model, result.usage);
    const hash = String(JSON.stringify(packet).length);
    const facets = result.facets ? (result.facets as unknown as Prisma.InputJsonValue) : undefined;
    await prisma.managerCommunicationProfile.upsert({
      where: { managerId: mgr.id },
      create: {
        managerId: mgr.id, profile: result.profile, styleSummary: result.styleSummary || null,
        facets, messagesConsidered: own.length,
        providerName: result.providerName, model: result.model, isMock: false, inputHash: hash,
      },
      update: {
        profile: result.profile, styleSummary: result.styleSummary || null,
        facets, messagesConsidered: own.length,
        providerName: result.providerName, model: result.model, isMock: false, inputHash: hash,
      },
    });
    // Content memory: this profile drew on these knowledge records.
    await recordContentUsage({ knowledgeIds: knowledge.map((k) => k.id), articleType: "MANAGER_COMM_PROFILE" });
    created++;
    cp.passes["manager-profiles"].doneManagerIds.push(mgr.id);
    saveCheckpoint(cp);
    console.log(`[manager-profiles] ${mgr.displayName}: ${result.styleSummary || "(profile saved)"}`);
  }
  return { aborted: false, created };
}

// ---------------------------------------------------------------------------
// Pass 3: relationship summaries (per meaningful pair)
// ---------------------------------------------------------------------------
async function passRelationships(
  managers: { id: string; displayName: string }[],
  convs: Conversation[],
  msgs: LoadedMessage[],
  cp: Checkpoint, args: Args, meter: Meter,
): Promise<{ aborted: boolean; created: number }> {
  const nameById = new Map(managers.map((m) => [m.id, m.displayName]));
  // Co-occurrence: conversations both participate in.
  const coConvs = new Map<string, Conversation[]>();
  for (const conv of convs) {
    const parts = [...new Set(conv.participantManagerIds)].filter((id) => nameById.has(id));
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const k = pairKey(parts[i], parts[j]);
        (coConvs.get(k) ?? coConvs.set(k, []).get(k)!).push(conv);
      }
    }
  }
  // Head-to-head via cached game logs.
  const gameLogs = new Map<string, Awaited<ReturnType<typeof buildManagerGameLog>>>();
  for (const m of managers) gameLogs.set(m.id, await buildManagerGameLog(m.id));

  const done = new Set(cp.passes.relationships.donePairKeys);
  // Eligible pairs: co-occur in >= minPairConvs conversations OR have head-to-head games.
  const eligible: { a: string; b: string; key: string }[] = [];
  for (let i = 0; i < managers.length; i++) {
    for (let j = i + 1; j < managers.length; j++) {
      const a = managers[i].id, b = managers[j].id;
      const k = pairKey(a, b);
      if (done.has(k)) continue;
      const co = coConvs.get(k)?.length ?? 0;
      const h2h = (gameLogs.get(a) ?? []).filter((g) => g.opponentId === b).length;
      if (co >= args.minPairConvs || h2h > 0) eligible.push({ a: a < b ? a : b, b: a < b ? b : a, key: k });
    }
  }
  const todo = args.limit ? eligible.slice(0, args.limit) : eligible;
  console.log(`[relationships] ${eligible.length} eligible pair(s); processing ${todo.length}`);
  if (args.dryRun) return { aborted: false, created: 0 };

  const safeguards = await getContentSafeguards();
  const msgById = new Map(msgs.map((m) => [m.id, m]));

  let created = 0;
  for (const pair of todo) {
    const aName = nameById.get(pair.a)!, bName = nameById.get(pair.b)!;
    const sharedKnowledge = await prisma.leagueKnowledge.findMany({
      where: { AND: [{ managers: { some: { managerId: pair.a } } }, { managers: { some: { managerId: pair.b } } }] },
      select: { knowledgeType: true, title: true, body: true },
      take: 15,
    });
    // Interaction samples: lines by A or B inside conversations they share.
    const shared = coConvs.get(pair.key) ?? [];
    const lines: string[] = [];
    for (const conv of shared) {
      for (const id of conv.messageIds) {
        const m = msgById.get(id);
        if (m && (m.managerId === pair.a || m.managerId === pair.b)) {
          const t = cleanLine(m.text);
          if (t.length > 3) lines.push(`${nameById.get(m.managerId!) ?? "?"}: ${t}`);
        }
      }
    }
    const interactionSamples = sampleEvenly(lines, 80);
    const aGames = (gameLogs.get(pair.a) ?? []).filter((g) => g.opponentId === pair.b);
    const aWins = aGames.filter((g) => g.result === "W").length;
    const bWins = aGames.filter((g) => g.result === "L").length;
    const playoffMeetings = aGames.filter((g) => g.isPlayoff).length;

    if (sharedKnowledge.length === 0 && interactionSamples.length === 0 && aGames.length === 0) {
      cp.passes.relationships.donePairKeys.push(pair.key);
      continue;
    }

    const packet: RelationshipPacket = {
      managerAName: aName, managerBName: bName,
      headToHead: `${aWins}-${bWins}`, playoffMeetings,
      sharedKnowledge: sharedKnowledge.map((k) => ({ type: k.knowledgeType, title: k.title, body: k.body })),
      interactionSamples,
    };
    const result = await generateRelationshipSummary(packet, safeguards, { model: args.synthModel });
    if (result.isMock) {
      console.log("[relationships] mock provider — aborting before any writes.");
      return { aborted: true, created };
    }
    meter.record(result.model, result.usage);
    await prisma.managerRelationship.upsert({
      where: { managerAId_managerBId: { managerAId: pair.a, managerBId: pair.b } },
      create: {
        managerAId: pair.a, managerBId: pair.b, relationshipType: result.relationshipType,
        summary: result.summary, intensity: result.intensity, privacyStatus: "PRIVATE",
        providerName: result.providerName, model: result.model, isMock: false,
      },
      update: {
        relationshipType: result.relationshipType, summary: result.summary, intensity: result.intensity,
        providerName: result.providerName, model: result.model, isMock: false,
      },
    });
    created++;
    cp.passes.relationships.donePairKeys.push(pair.key);
    saveCheckpoint(cp);
    console.log(`[relationships] ${aName} <> ${bName}: ${result.relationshipType} (${result.intensity.toFixed(2)})`);
  }
  return { aborted: false, created };
}

// ---------------------------------------------------------------------------
// Pass 4: league-wide profile (singleton)
// ---------------------------------------------------------------------------
async function passLeagueProfile(cp: Checkpoint, args: Args, meter: Meter): Promise<{ aborted: boolean; created: number }> {
  if (cp.passes["league-profile"].done) {
    console.log("[league-profile] already done — skipping");
    return { aborted: false, created: 0 };
  }
  console.log("[league-profile] building league-wide voice profile");
  if (args.dryRun) return { aborted: false, created: 0 };

  const league = await prisma.league.findFirst({ select: { id: true, name: true } });
  if (!league) {
    console.log("[league-profile] no League row found — skipping");
    return { aborted: false, created: 0 };
  }
  const safeguards = await getContentSafeguards();
  const [styles, knowledge, history, seasons] = await Promise.all([
    prisma.managerCommunicationProfile.findMany({ select: { styleSummary: true, manager: { select: { displayName: true } } } }),
    prisma.leagueKnowledge.findMany({
      where: { knowledgeType: { in: ["TRADITION", "INSIDE_JOKE", "STORYLINE", "RIVALRY", "MEMORABLE_MOMENT"] } },
      select: { knowledgeType: true, title: true, body: true },
      orderBy: { confidence: "desc" },
      take: 60,
    }),
    prisma.leagueHistorySection.findMany({ select: { year: true, title: true }, orderBy: { year: "asc" }, take: 40 }),
    prisma.season.findMany({ select: { year: true }, orderBy: { year: "asc" } }),
  ]);

  const years = seasons.map((s) => s.year);
  const packet: LeagueProfilePacket = {
    leagueName: league.name,
    seasonsCovered: years.length ? `${years[0]}–${years.at(-1)}` : "—",
    managerCount: styles.length,
    managerStyles: styles.filter((s) => s.styleSummary).map((s) => ({ name: s.manager.displayName, style: s.styleSummary! })),
    knowledge: knowledge.map((k) => ({ type: k.knowledgeType, title: k.title, body: k.body })),
    historyTitles: history.map((h) => `${h.year ?? ""} ${h.title}`.trim()),
  };
  const result = await generateLeagueCommunicationProfile(packet, safeguards, { model: args.synthModel });
  if (result.isMock) {
    console.log("[league-profile] mock provider — aborting before any writes.");
    return { aborted: true, created: 0 };
  }
  meter.record(result.model, result.usage);
  await prisma.leagueProfile.upsert({
    where: { leagueId: league.id },
    create: {
      leagueId: league.id, humorStyle: result.humorStyle || null, communicationStyle: result.communicationStyle || null,
      dynamics: result.dynamics || null, traditions: result.traditions || null, historicalContext: result.historicalContext || null,
      providerName: result.providerName, model: result.model, isMock: false,
    },
    update: {
      humorStyle: result.humorStyle || null, communicationStyle: result.communicationStyle || null,
      dynamics: result.dynamics || null, traditions: result.traditions || null, historicalContext: result.historicalContext || null,
      providerName: result.providerName, model: result.model, isMock: false,
    },
  });
  cp.passes["league-profile"].done = true;
  saveCheckpoint(cp);
  console.log("[league-profile] saved");
  return { aborted: false, created: 1 };
}

// ---------------------------------------------------------------------------
// Pass 5: regenerate saved content + wire content memory
// ---------------------------------------------------------------------------
async function passRegenerate(
  managers: { id: string; displayName: string }[],
  // Perf-summary regeneration goes through manager-repository, which doesn't
  // surface token usage, so this pass isn't metered (a handful of cheap calls).
  cp: Checkpoint, args: Args, _meter: Meter,
): Promise<{ aborted: boolean; created: number }> {
  const done = new Set(cp.passes.regenerate.doneManagerIds);
  const todoAll = managers.filter((m) => !done.has(m.id));
  const todo = args.limit ? todoAll.slice(0, args.limit) : todoAll;
  console.log(`[regenerate] ${todoAll.length} manager(s) remaining; processing ${todo.length}`);
  if (args.dryRun) return { aborted: false, created: 0 };

  let created = 0;
  for (const mgr of todo) {
    const r = await regenerateManagerPerformanceSummary(mgr.id);
    if (r && r.isMock) {
      console.log("[regenerate] mock provider — aborting before any writes.");
      return { aborted: true, created };
    }
    // Content memory: record the approved knowledge this summary could draw on.
    const approved = await prisma.leagueKnowledge.findMany({
      where: { approvalStatus: "APPROVED", privacyStatus: "PUBLIC_SAFE", managers: { some: { managerId: mgr.id } } },
      select: { id: true }, take: 10,
    });
    await recordContentUsage({
      knowledgeIds: approved.map((k) => k.id),
      factKeys: [`manager:${mgr.id}:perf-summary`],
      articleType: "MANAGER_PROFILE",
    });
    if (r) created++;
    cp.passes.regenerate.doneManagerIds.push(mgr.id);
    saveCheckpoint(cp);
    console.log(`[regenerate] ${mgr.displayName}: ${r ? (r.isMock ? "[mock]" : "[ai]") : "[skip: no data]"}`);
  }
  return { aborted: false, created };
}

// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs();
  const cp = loadCheckpoint(args.fresh);
  const meter = new Meter();
  const runPasses = args.pass === "all" ? ALL_PASSES : [args.pass];
  const env = getEnv();

  console.log("=== Chat-archive consolidation ===");
  console.log(`passes: ${runPasses.join(", ")} | dryRun: ${args.dryRun} | fresh: ${args.fresh}`);
  console.log(`models: extract=${args.extractModel ?? env.OPENAI_MODEL}, synth=${args.synthModel}`);
  console.log(`AI configured: ${env.OPENAI_API_KEY.trim().length > 0 ? "yes" : "NO (mock — nothing will be written)"}`);

  const [managers, messages] = await Promise.all([
    prisma.manager.findMany({ where: { deletedAt: null }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
    loadMessages(),
  ]);
  const groupable: GroupableMessage[] = messages.map((m) => ({
    id: m.id, timestampMs: m.timestampMs, managerId: m.managerId,
    senderLabel: m.senderLabel, text: m.text, sourcePage: m.sourcePage,
  }));
  const convs = groupConversations(groupable, { gapMinutes: args.gapMinutes, maxMessages: args.maxMessages });
  console.log(`data: ${messages.length} messages, ${convs.length} conversations, ${managers.length} managers\n`);

  let aborted = false;
  const summary: Record<string, number> = {};
  for (const pass of runPasses) {
    if (aborted) break;
    let res: { aborted: boolean; created: number } = { aborted: false, created: 0 };
    if (pass === "extract") res = await passExtract(convs, cp, args, meter);
    else if (pass === "manager-profiles") res = await passManagerProfiles(managers, messages, cp, args, meter);
    else if (pass === "relationships") res = await passRelationships(managers, convs, messages, cp, args, meter);
    else if (pass === "league-profile") res = await passLeagueProfile(cp, args, meter);
    else if (pass === "regenerate") res = await passRegenerate(managers, cp, args, meter);
    summary[pass] = res.created;
    aborted = res.aborted;
  }

  saveCheckpoint(cp);
  console.log("\n=== Summary ===");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v} created/updated`);
  console.log("\n=== Token usage / estimated cost ===");
  console.log(meter.report());
  if (aborted) console.log("\nRun ABORTED (mock provider). Set OPENAI_API_KEY and re-run — progress is checkpointed.");
  else console.log("\nRun complete. Re-run any time; completed items are skipped via the checkpoint.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
