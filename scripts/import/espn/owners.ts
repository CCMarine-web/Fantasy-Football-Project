import { prisma } from "@/lib/db";
import type { EspnMember, EspnSeasonData } from "./client";

/**
 * Resolves ESPN member accounts to Manager rows.
 *
 * ── Why this is a whole-history pass, not a per-season one ─────────────────
 * ESPN accounts get renamed. In this league one manager's original account
 * (`logan.javier@aol.com`) still owns his team in 2021-2022 but by then ESPN
 * renders its name as "distemp16+ distemp16+" — a junk string left over from a
 * rename. Resolving season by season would match that account to the right
 * person for 2017-2020 and then invent a brand-new "distemp16+" manager for
 * 2021-2022, splitting one career in two.
 *
 * So identity is resolved ONCE across every fetched season: every name an
 * account has ever carried is pooled, and the account matches a manager if ANY
 * of those names matches. That fixes renames without ever relying on weaker
 * signals like "co-owned the same team", which would happily merge two real
 * people who once shared a roster.
 *
 * ── What is never done ────────────────────────────────────────────────────
 * Nothing is fuzzy-matched. A name matches on exact normalised equality
 * against a manager's display name or a recorded alias, or it does not match.
 * An account that matches nothing becomes its OWN retired manager — never
 * folded into an existing one — so a former member's history stays theirs.
 */

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Names ESPN generates rather than names a person chose. Matching on these
 * would be worse than not matching: "distemp16+" is a rename artefact and
 * "espn member" style placeholders identify nobody.
 */
function isJunkName(value: string): boolean {
  const n = normalize(value);
  if (n.length < 2) return true;
  if (/^distemp\d*$/.test(n)) return true;
  if (/^espn(member|user)?\d*$/.test(n)) return true;
  if (/^(unknown|none|null|na|tbd|team)$/.test(n)) return true;
  return false;
}

/** Every distinct name an ESPN account has carried, across all fetched seasons. */
export interface OwnerAccount {
  /** ESPN member id. Held in memory only — never written to the database. */
  espnMemberId: string;
  /** Display names and first/last combinations, newest season first. */
  names: string[];
  /** Seasons in which this account owned a team. */
  seasons: number[];
}

export interface OwnerResolution {
  managerId: string;
  managerName: string;
  /** How the account was matched, for the import report. */
  via: "display-name" | "full-name" | "alias" | "created-retired";
  /** The specific name string that matched. */
  matchedOn: string;
  createdRetiredManager: boolean;
}

export interface OwnerMap {
  /** ESPN member id -> resolution. */
  byMemberId: Map<string, OwnerResolution>;
  accounts: OwnerAccount[];
}

function namesOf(member: EspnMember): string[] {
  const full = [member.firstName, member.lastName]
    .filter((p) => p && p.trim())
    .join(" ")
    .trim();
  return [member.displayName?.trim(), full]
    .filter((n): n is string => !!n && n.length > 0)
    .filter((n) => !isJunkName(n));
}

/**
 * Collects one account record per ESPN member across every season that was
 * successfully fetched.
 */
export function collectAccounts(seasons: { year: number; data: EspnSeasonData }[]): OwnerAccount[] {
  const accounts = new Map<string, OwnerAccount>();
  // Newest season first, so the name a manager used most recently is preferred
  // when a retired manager has to be created from scratch.
  for (const { year, data } of [...seasons].sort((a, b) => b.year - a.year)) {
    const ownedIds = new Set<string>();
    for (const team of data.teams ?? []) {
      for (const owner of team.owners ?? []) ownedIds.add(owner);
      if (team.primaryOwner) ownedIds.add(team.primaryOwner);
    }
    for (const member of data.members ?? []) {
      const existing = accounts.get(member.id) ?? {
        espnMemberId: member.id,
        names: [],
        seasons: [],
      };
      for (const name of namesOf(member)) {
        if (!existing.names.some((n) => normalize(n) === normalize(name)))
          existing.names.push(name);
      }
      if (ownedIds.has(member.id) && !existing.seasons.includes(year)) existing.seasons.push(year);
      accounts.set(member.id, existing);
    }
  }
  return [...accounts.values()];
}

/**
 * Matches accounts to managers, creating retired managers for the unmatched.
 * `dryRun` resolves without writing, so `--dry-run` can print the exact
 * mapping that a real run would apply.
 */
export async function resolveOwners(accounts: OwnerAccount[], dryRun: boolean): Promise<OwnerMap> {
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, aliases: { select: { value: true, aliasType: true } } },
  });

  const byDisplayName = new Map<string, { id: string; displayName: string }>();
  const byAlias = new Map<string, { id: string; displayName: string }>();
  for (const manager of managers) {
    byDisplayName.set(normalize(manager.displayName), manager);
    for (const alias of manager.aliases) {
      if (isJunkName(alias.value)) continue;
      // First writer wins: a later manager must not steal an alias key that
      // already points somewhere, because that would silently merge two people.
      const key = normalize(alias.value);
      if (!byAlias.has(key)) byAlias.set(key, manager);
    }
  }

  const byMemberId = new Map<string, OwnerResolution>();

  for (const account of accounts) {
    let resolution: OwnerResolution | undefined;

    for (const name of account.names) {
      const key = normalize(name);
      const direct = byDisplayName.get(key);
      if (direct) {
        resolution = {
          managerId: direct.id,
          managerName: direct.displayName,
          via: "display-name",
          matchedOn: name,
          createdRetiredManager: false,
        };
        break;
      }
      const aliased = byAlias.get(key);
      if (aliased) {
        resolution = {
          managerId: aliased.id,
          managerName: aliased.displayName,
          via: "alias",
          matchedOn: name,
          createdRetiredManager: false,
        };
        break;
      }
    }

    if (!resolution) {
      // Nobody in the database corresponds to this account. Preserve them as a
      // retired manager of their own rather than attaching their seasons to
      // somebody else's career.
      const label = account.names[0] ?? `ESPN member (unnamed)`;
      if (dryRun) {
        resolution = {
          managerId: `<would-create:${label}>`,
          managerName: label,
          via: "created-retired",
          matchedOn: label,
          createdRetiredManager: true,
        };
      } else {
        const earliest = account.seasons.length ? Math.min(...account.seasons) : undefined;
        const created = await prisma.manager.create({
          data: {
            displayName: label,
            joinedYear: earliest ?? 0,
            isActive: false,
            bio: "Former manager from the league's ESPN era (2017-2022). Imported from ESPN league history; no Sleeper account.",
          },
          select: { id: true, displayName: true },
        });
        resolution = {
          managerId: created.id,
          managerName: created.displayName,
          via: "created-retired",
          matchedOn: label,
          createdRetiredManager: true,
        };
        // Register so a second account with the same name maps to this row
        // rather than creating a duplicate.
        byDisplayName.set(normalize(created.displayName), created);
      }
    }

    byMemberId.set(account.espnMemberId, resolution);
  }

  return { byMemberId, accounts };
}

/**
 * Records the ESPN names an already-known manager used, so future imports and
 * the chat-identity resolver can match them. Never touches display names.
 */
export async function recordEspnAliases(map: OwnerMap): Promise<number> {
  let written = 0;
  const managers = await prisma.manager.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true, aliases: { select: { aliasType: true, value: true } } },
  });
  const byId = new Map(managers.map((m) => [m.id, m]));

  for (const account of map.accounts) {
    const resolution = map.byMemberId.get(account.espnMemberId);
    if (!resolution || resolution.createdRetiredManager) continue;
    const manager = byId.get(resolution.managerId);
    if (!manager) continue;

    for (const name of account.names) {
      if (normalize(name) === normalize(manager.displayName)) continue;
      // The unique key includes aliasType, so checking only OTHER would add a
      // second copy of a name already recorded as, say, SLEEPER_USERNAME —
      // which then renders twice everywhere aliases are listed.
      const alreadyKnown = manager.aliases.some((a) => normalize(a.value) === normalize(name));
      if (alreadyKnown) continue;

      await prisma.managerAlias.create({
        data: {
          managerId: manager.id,
          aliasType: "OTHER",
          value: name,
          source: "ESPN league history",
          confidence: 1,
        },
      });
      manager.aliases.push({ aliasType: "OTHER", value: name });
      written++;
    }
  }
  return written;
}

/**
 * Chooses which manager a team belongs to. `primaryOwner` wins; co-owners are
 * only consulted if the primary owner is missing or already claimed by another
 * team in the same season (FantasyTeam is unique per season+manager).
 */
export function teamOwner(
  team: { primaryOwner?: string; owners?: string[] },
  map: OwnerMap,
  claimed: Set<string>,
): OwnerResolution | undefined {
  const candidates = [team.primaryOwner, ...(team.owners ?? [])].filter((o): o is string => !!o);
  const resolutions = candidates
    .map((id) => map.byMemberId.get(id))
    .filter((r): r is OwnerResolution => !!r);
  return resolutions.find((r) => !claimed.has(r.managerId)) ?? resolutions[0];
}
