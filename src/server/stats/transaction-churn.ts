/**
 * TRANSACTION CHURN — collapse a manager flipping the same players back and
 * forth into one row.
 *
 * Week 9, 2026: Patrick McManus picked up and dropped Kendre Miller and Austin
 * Ekeler five times over, and the wire showed six rows for what was one story.
 * Moves by the same manager in the same week that share a player are grouped;
 * a group of three or more in which some player was both added AND dropped is
 * churn, and becomes one row with the net effect:
 *
 *   "Patrick McManus swapped Kendre Miller ↔ Austin Ekeler ×5 · net +Wan'Dale Robinson, −Tyjae Spears"
 *
 * Trades, failed claims and anything not involving a repeated player are left
 * exactly as they were.
 */

export interface ChurnAsset {
  playerName: string | null;
  managerId: string | null;
  managerName: string;
}

export interface ChurnMove {
  id: string;
  week: number | null;
  type: string;
  outcome: string;
  processedAt: Date | string;
  added: ChurnAsset[];
  dropped: ChurnAsset[];
}

export interface ChurnSummary {
  /** How many original moves this row stands for. */
  moves: number;
  /** "swapped ×5": moves after the first. */
  swaps: number;
  /** Players added and dropped within the group, in first-seen order. */
  churnedPlayers: string[];
  netAdded: string[];
  netDropped: string[];
  managerName: string;
  ids: string[];
}

const ELIGIBLE_TYPES = new Set(["FREE_AGENT", "WAIVER"]);

function managerOf(m: ChurnMove): string | null {
  return m.added[0]?.managerId ?? m.dropped[0]?.managerId ?? null;
}

function players(m: ChurnMove): string[] {
  return [...m.added, ...m.dropped].map((a) => a.playerName).filter((p): p is string => !!p);
}

/**
 * Returns the moves with churn groups replaced by one representative (the most
 * recent move of the group) carrying a `churn` summary. Order is preserved by
 * each group's most recent move.
 */
export function collapseChurn<T extends ChurnMove>(moves: T[]): (T & { churn?: ChurnSummary })[] {
  const time = (m: ChurnMove) => new Date(m.processedAt).getTime();
  const buckets = new Map<string, T[]>();
  for (const m of moves) {
    const manager = managerOf(m);
    if (!manager || m.week == null || !ELIGIBLE_TYPES.has(m.type) || m.outcome !== "SUCCESSFUL") continue;
    const key = `${manager}|${m.week}`;
    buckets.set(key, [...(buckets.get(key) ?? []), m]);
  }

  const replaced = new Map<string, T & { churn: ChurnSummary }>();
  const absorbed = new Set<string>();

  for (const bucket of buckets.values()) {
    if (bucket.length < 3) continue;
    // Connected components over shared players.
    const parent = bucket.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const firstWith = new Map<string, number>();
    bucket.forEach((m, i) => {
      for (const p of players(m)) {
        const j = firstWith.get(p);
        if (j == null) firstWith.set(p, i);
        else parent[find(i)] = find(j);
      }
    });
    const groups = new Map<number, T[]>();
    bucket.forEach((m, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), m]));

    for (const group of groups.values()) {
      if (group.length < 3) continue;
      const ordered = [...group].sort((a, b) => time(a) - time(b));
      const firstAction = new Map<string, "ADD" | "DROP">();
      const lastAction = new Map<string, "ADD" | "DROP">();
      const seenBoth = new Map<string, Set<"ADD" | "DROP">>();
      for (const m of ordered) {
        for (const [list, action] of [[m.dropped, "DROP"], [m.added, "ADD"]] as const) {
          for (const a of list) {
            if (!a.playerName) continue;
            if (!firstAction.has(a.playerName)) firstAction.set(a.playerName, action);
            lastAction.set(a.playerName, action);
            seenBoth.set(a.playerName, (seenBoth.get(a.playerName) ?? new Set()).add(action));
          }
        }
      }
      const churned = [...firstAction.keys()].filter((p) => seenBoth.get(p)?.size === 2);
      if (churned.length === 0) continue;

      const netAdded = [...firstAction.keys()].filter((p) => firstAction.get(p) === "ADD" && lastAction.get(p) === "ADD");
      const netDropped = [...firstAction.keys()].filter((p) => firstAction.get(p) === "DROP" && lastAction.get(p) === "DROP");
      const latest = ordered[ordered.length - 1];
      const managerName = latest.added[0]?.managerName ?? latest.dropped[0]?.managerName ?? "";
      replaced.set(latest.id, {
        ...latest,
        churn: {
          moves: ordered.length,
          swaps: ordered.length - 1,
          churnedPlayers: churned,
          netAdded,
          netDropped,
          managerName,
          ids: ordered.map((m) => m.id),
        },
      });
      for (const m of ordered) if (m.id !== latest.id) absorbed.add(m.id);
    }
  }

  return moves.filter((m) => !absorbed.has(m.id)).map((m) => replaced.get(m.id) ?? m);
}

/** "Patrick McManus swapped Kendre Miller ↔ Austin Ekeler ×5 · net +Wan'Dale Robinson, −Tyjae Spears". */
export function describeChurn(c: ChurnSummary): string {
  const net = [...c.netAdded.map((p) => `+${p}`), ...c.netDropped.map((p) => `−${p}`)];
  return `${c.managerName} swapped ${c.churnedPlayers.join(" ↔ ")} ×${c.swaps}${net.length ? ` · net ${net.join(", ")}` : " · no net change"}`;
}
