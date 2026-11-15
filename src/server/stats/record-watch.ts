/**
 * RECORD WATCH — active chases of all-time league records.
 *
 * Season records (best/worst record, most points) count completed seasons
 * only; a season in progress is never "the record". This is the other half:
 * what the season in progress is threatening, stated as a chase.
 *
 *   streaks      an active win or losing streak within 2 games of the
 *                all-time mark (or past it)
 *   single game  a score this season inside the all-time top/bottom 10
 *   season pace  points-for and record projected over the regular season,
 *                when on pace to match or beat a completed-season record
 *
 * Pure: the repository gathers verified games and completed-season lines.
 */

export interface WatchGame {
  managerId: string;
  managerName: string;
  year: number;
  week: number;
  isPlayoff: boolean;
  score: number;
  opponentScore: number;
  opponentName: string;
}

export interface CompletedSeasonLine {
  managerName: string;
  year: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface CurrentTeamLine {
  managerId: string;
  managerName: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export type WatchKind = "WIN_STREAK" | "LOSS_STREAK" | "HIGH_GAME" | "LOW_GAME" | "POINTS_PACE" | "BEST_RECORD_PACE" | "WORST_RECORD_PACE";

export interface RecordWatchItem {
  key: string;
  kind: WatchKind;
  managerId: string;
  managerName: string;
  /** One line, e.g. "Michael Shea has lost 9 straight". */
  headline: string;
  /** The record in play, e.g. "One more loss ties the all-time mark of 10 (Logan Javier & Michael Barkemeyer)". */
  detail: string;
  /** For ordering: higher is more urgent. */
  urgency: number;
}

function result(g: WatchGame): "W" | "L" | "T" {
  return g.score > g.opponentScore ? "W" : g.score < g.opponentScore ? "L" : "T";
}

function chronological(games: WatchGame[]): WatchGame[] {
  return [...games].sort((a, b) => a.year - b.year || a.week - b.week);
}

function longest(games: WatchGame[], r: "W" | "L"): number {
  let best = 0;
  let cur = 0;
  for (const g of chronological(games)) {
    cur = result(g) === r ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}

function active(games: WatchGame[]): { result: "W" | "L" | null; length: number } {
  const ordered = chronological(games);
  const last = ordered.at(-1);
  if (!last || result(last) === "T") return { result: null, length: 0 };
  const r = result(last) as "W" | "L";
  let length = 0;
  for (let i = ordered.length - 1; i >= 0 && result(ordered[i]) === r; i -= 1) length += 1;
  return { result: r, length };
}

function holders(entries: { name: string; len: number }[], best: number): string {
  return [...new Set(entries.filter((e) => e.len === best).map((e) => e.name))].sort().join(" & ");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function computeRecordWatch(input: {
  seasonYear: number;
  regularSeasonWeeks: number;
  games: WatchGame[];
  completedSeasons: CompletedSeasonLine[];
  currentTeams: CurrentTeamLine[];
}): RecordWatchItem[] {
  const { seasonYear, regularSeasonWeeks, games, completedSeasons, currentTeams } = input;
  const items: RecordWatchItem[] = [];
  const byManager = new Map<string, WatchGame[]>();
  for (const g of games) byManager.set(g.managerId, [...(byManager.get(g.managerId) ?? []), g]);

  // ── Streaks: the same game set and rule as the Records page (every game,
  // regular season and postseason; a tie ends a streak).
  for (const r of ["W", "L"] as const) {
    const all = [...byManager.entries()].map(([, log]) => ({ name: log[0].managerName, len: longest(log, r) }));
    const record = Math.max(0, ...all.map((e) => e.len));
    for (const [managerId, log] of byManager) {
      const cur = active(log);
      if (cur.result !== r || cur.length < 3) continue;
      // Only streaks still alive in the current season are a chase.
      if (chronological(log).at(-1)?.year !== seasonYear) continue;
      const gap = record - cur.length;
      if (gap > 2) continue;
      const word = r === "W" ? "win" : "loss";
      const otherHolders = all.filter((e) => e.len === record && e.name !== log[0].managerName);
      const holderText = holders(all, record);
      let detail: string;
      if (gap === 0) {
        detail = otherHolders.length
          ? `That ties the all-time ${word === "win" ? "win" : "losing"} streak of ${record} (${holderText}). One more ${word} and it's ${log[0].managerName}'s alone.`
          : `That IS the all-time ${word === "win" ? "win" : "losing"} streak — and it's still going.`;
      } else if (gap < 0) {
        detail = `A new all-time record, past the old mark of ${record}.`;
      } else {
        detail =
          gap === 1
            ? `One more ${word} ties the all-time mark of ${record} (${holderText}).`
            : `Two more ${word === "loss" ? "losses" : "wins"} tie the all-time mark of ${record} (${holderText}).`;
      }
      items.push({
        key: `${r}-streak-${managerId}`,
        kind: r === "W" ? "WIN_STREAK" : "LOSS_STREAK",
        managerId,
        managerName: log[0].managerName,
        headline: `${log[0].managerName} has ${r === "W" ? "won" : "lost"} ${cur.length} straight`,
        detail,
        urgency: 100 - gap * 10,
      });
    }
  }

  // ── Single games this season inside the all-time top or bottom 10.
  const ranked = [...games].sort((a, b) => b.score - a.score);
  const thisSeason = games.filter((g) => g.year === seasonYear);
  if (thisSeason.length) {
    const best = thisSeason.reduce((a, b) => (b.score > a.score ? b : a));
    const rankHigh = ranked.findIndex((g) => g === best) + 1;
    if (rankHigh > 0 && rankHigh <= 10) {
      items.push({
        key: `high-game-${best.managerId}`,
        kind: "HIGH_GAME",
        managerId: best.managerId,
        managerName: best.managerName,
        headline: `${best.managerName}'s ${best.score.toFixed(1)} (Week ${best.week}) is the season high`,
        detail:
          rankHigh === 1
            ? "The highest score in league history."
            : `${ordinal(rankHigh)}-highest score in league history (record ${ranked[0].score.toFixed(1)}, ${ranked[0].managerName}, ${ranked[0].year}).`,
        urgency: 60 - rankHigh,
      });
    }
    const worst = thisSeason.reduce((a, b) => (b.score < a.score ? b : a));
    const rankLow = [...ranked].reverse().findIndex((g) => g === worst) + 1;
    if (rankLow > 0 && rankLow <= 10) {
      const lowest = ranked.at(-1) as WatchGame;
      items.push({
        key: `low-game-${worst.managerId}`,
        kind: "LOW_GAME",
        managerId: worst.managerId,
        managerName: worst.managerName,
        headline: `${worst.managerName}'s ${worst.score.toFixed(1)} (Week ${worst.week}) is the season low`,
        detail:
          rankLow === 1
            ? "The lowest score in league history."
            : `${ordinal(rankLow)}-lowest score in league history (record ${lowest.score.toFixed(1)}, ${lowest.managerName}, ${lowest.year}).`,
        urgency: 55 - rankLow,
      });
    }
  }

  // ── Season pace, against COMPLETED seasons only.
  const pct = (t: { wins: number; losses: number; ties: number }) => {
    const n = t.wins + t.losses + t.ties;
    return n ? (t.wins + 0.5 * t.ties) / n : 0;
  };
  if (completedSeasons.length) {
    const mostPts = completedSeasons.reduce((a, b) => (b.pointsFor > a.pointsFor ? b : a));
    const bestRec = completedSeasons.reduce((a, b) => (pct(b) > pct(a) ? b : a));
    const worstRec = completedSeasons.reduce((a, b) => (pct(b) < pct(a) ? b : a));
    for (const t of currentTeams) {
      const played = t.wins + t.losses + t.ties;
      if (played < 3 || played >= regularSeasonWeeks) continue;
      const left = regularSeasonWeeks - played;
      const ptsPace = (t.pointsFor / played) * regularSeasonWeeks;
      if (ptsPace > mostPts.pointsFor) { // only paces that would BREAK the record
        items.push({
          key: `pts-pace-${t.managerId}`,
          kind: "POINTS_PACE",
          managerId: t.managerId,
          managerName: t.managerName,
          headline: `${t.managerName} is on pace for ${ptsPace.toFixed(0)} points`,
          detail: `The single-season record is ${mostPts.pointsFor.toFixed(1)} (${mostPts.managerName}, ${mostPts.year}).`,
          urgency: 40 + ptsPace / 10_000, // sorted by pace
        });
      }
      // Best case and worst case with the games left, against the record marks.
      const fmt = (w: number, l: number) => `${w}-${l}`;
      if (pct(t) > pct(bestRec)) {
        items.push({
          key: `best-pace-${t.managerId}`,
          kind: "BEST_RECORD_PACE",
          managerId: t.managerId,
          managerName: t.managerName,
          headline: `${t.managerName} is ${fmt(t.wins, t.losses)} with ${plural(left, "game")} left`,
          detail: `On pace to match or beat the best regular season ever, ${fmt(bestRec.wins, bestRec.losses)} (${bestRec.managerName}, ${bestRec.year}).`,
          urgency: 45,
        });
      }
      if (pct(t) < pct(worstRec)) {
        items.push({
          key: `worst-pace-${t.managerId}`,
          kind: "WORST_RECORD_PACE",
          managerId: t.managerId,
          managerName: t.managerName,
          headline: `${t.managerName} is ${fmt(t.wins, t.losses)} with ${plural(left, "game")} left`,
          detail:
            t.wins <= worstRec.wins
              ? `The worst regular season ever is ${fmt(worstRec.wins, worstRec.losses)} (${worstRec.managerName}, ${worstRec.year}). ${worstRec.wins + 1 - t.wins > left ? "Can no longer avoid tying it." : `Needs ${plural(worstRec.wins + 1 - t.wins, "more win")} to avoid it.`}`
              : `On pace for the worst regular season ever, ${fmt(worstRec.wins, worstRec.losses)} (${worstRec.managerName}, ${worstRec.year}).`,
          urgency: 50,
        });
      }
    }
  }

  return items.sort((a, b) => b.urgency - a.urgency || a.key.localeCompare(b.key));
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
