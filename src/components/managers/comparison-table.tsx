"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { managerPath } from "@/lib/slug";
import type { ComparisonRow } from "@/server/repositories/manager-comparison";

type Key = "name" | "record" | "winPct" | "titles" | "finals" | "playoff" | "ppg" | "allPlayPct" | "luck" | "lastPlaces";

const COLUMNS: { key: Key; label: string; title: string; value: (r: ComparisonRow) => number | string }[] = [
  { key: "record", label: "W-L", title: "Career regular-season record", value: (r) => r.wins - r.losses },
  { key: "winPct", label: "Win %", title: "Regular-season win percentage", value: (r) => r.winPct },
  { key: "titles", label: "Titles", title: "Championships", value: (r) => r.titles },
  { key: "finals", label: "Finals", title: "Finals appearances (titles included)", value: (r) => r.finals },
  { key: "playoff", label: "Playoffs", title: "Championship-bracket record", value: (r) => r.playoffWins - r.playoffLosses / 100 },
  { key: "ppg", label: "PPG", title: "Regular-season points per game", value: (r) => r.ppg ?? -1 },
  { key: "allPlayPct", label: "All-play", title: "How often a weekly score would beat a random opponent", value: (r) => r.allPlayPct ?? -1 },
  { key: "luck", label: "Luck", title: "Career Luck Score (50 = neutral)", value: (r) => r.luck ?? -1 },
  { key: "lastPlaces", label: "Last", title: "Regular-season last-place finishes", value: (r) => r.lastPlaces },
];

/** Sortable career comparison — click a column to sort; click again to flip. */
export function ManagerComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const [sort, setSort] = useState<{ key: Key; desc: boolean }>({ key: "winPct", desc: true });
  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sort.key);
    const v = (r: ComparisonRow) => (sort.key === "name" ? r.name : (col?.value(r) ?? 0));
    return [...rows].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const cmp = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
      return sort.desc ? -cmp : cmp;
    });
  }, [rows, sort]);
  const header = (key: Key, label: string, title: string, align = "text-right") => (
    <th scope="col" className={`px-2 py-2 ${align} whitespace-nowrap`} aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button
        type="button"
        title={title}
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" && key !== "lastPlaces" }))}
        className="inline-flex min-h-8 items-center gap-0.5 text-xs font-medium tracking-wide uppercase hover:text-foreground"
      >
        {label}
        {sort.key === key ? sort.desc ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden /> : null}
      </button>
    </th>
  );
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border/60 bg-card" role="region" aria-label="Manager comparison, scrolls sideways" tabIndex={0}>
      <table className="w-full min-w-[780px] border-separate border-spacing-0 text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-card px-2 py-2 text-left">
              <button type="button" onClick={() => setSort((s) => ({ key: "name", desc: s.key === "name" ? !s.desc : false }))} className="min-h-8 text-xs font-medium tracking-wide uppercase hover:text-foreground">
                Manager
              </button>
            </th>
            {COLUMNS.map((c) => header(c.key, c.label, c.title))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.managerId} className="border-t border-border/40 hover:bg-accent/20">
              <td className="sticky left-0 z-10 border-t border-border/40 bg-card px-2 py-1.5">
                <Link href={managerPath(r.name)} className="flex items-center gap-2 hover:text-primary">
                  <TeamAvatar name={r.name} imageUrl={r.photoUrl} className="h-7 w-7 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.name}</span>
                    {!r.isActive ? <span className="block text-[11px] text-muted-foreground">retired</span> : null}
                  </span>
                </Link>
              </td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{`${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`}</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{(r.winPct * 100).toFixed(1)}%</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{r.titles}</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{r.finals}</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{`${r.playoffWins}-${r.playoffLosses}`}</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{r.ppg?.toFixed(1) ?? "—"}</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{r.allPlayPct != null ? `${r.allPlayPct.toFixed(1)}%` : "—"}</td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums" title={r.luckLabel ?? undefined}>
                {r.luck ?? "—"}
              </td>
              <td className="border-t border-border/40 px-2 text-right font-mono tabular-nums">{r.lastPlaces}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
