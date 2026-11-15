"use client";

import Link from "next/link";
import { formatOdds } from "@/lib/format";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { FormChips } from "@/components/shared/form-chips";
import { DataTable, type Column } from "@/components/shared/data-table";
import { managerPath } from "@/lib/slug";
import type { StandingsRow } from "@/types/view-models";

/** "Patrick McManus" → "McManus": the phone column's short name. */
export function shortManagerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(" ") : name;
}

/**
 * The standings table (on the shared DataTable).
 *
 * Default columns (Nov 2026 redesign): rank, team, W-L, PF, PA, luck and
 * playoff %. All-play, expected wins, bye/title/last odds and form sit behind
 * "More columns". Rank and team stay pinned; the team cell is one line (team
 * name, manager surname beside it on wider screens). Headers sort; the default
 * order is the standings order, and the playoff cut line shows only in it.
 */
export function StandingsTable({
  rows,
  caption,
  playoffTeams,
  formLabel,
}: {
  rows: StandingsRow[];
  caption?: string;
  /** Draw the cut line after this many teams. Omit for no line. */
  playoffTeams?: number;
  /** e.g. "Last 5 through Week 9". */
  formLabel?: string;
}) {
  const gamesPlayed = rows.some((r) => r.wins + r.losses + r.ties > 0);
  const hasOdds = rows.some((r) => r.odds);
  const showCut = gamesPlayed && playoffTeams != null && playoffTeams > 0 && playoffTeams < rows.length;
  const rankOf = (row: StandingsRow, index: number) => row.rank || (gamesPlayed ? index + 1 : null);
  const marks = rows.some((r) => r.odds?.clinched || r.odds?.eliminated);
  const winPct = (r: StandingsRow) => {
    const g = r.wins + r.losses + r.ties;
    return g ? (r.wins + 0.5 * r.ties) / g : null;
  };

  const oddsColumns: Column<StandingsRow>[] = hasOdds
    ? [
        {
          key: "playoff",
          header: "Playoff",
          title: "Share of 10,000 simulated seasons that end in the playoffs",
          numeric: true,
          sortValue: (r) => r.odds?.playoffPct ?? null,
          cell: (r) => (
            <span className="font-semibold">
              {r.odds?.clinched ? (
                <span className="rounded bg-field/20 px-1 text-field" title="Clinched a playoff spot">
                  x
                </span>
              ) : r.odds?.eliminated ? (
                <span className="rounded bg-destructive/20 px-1 text-destructive" title="Eliminated from playoff contention">
                  e
                </span>
              ) : null}{" "}
              {r.odds ? formatOdds(r.odds.playoffPct, r.odds) : "—"}
            </span>
          ),
        },
        {
          key: "bye",
          header: "Bye",
          title: "Simulated chance of a first-round bye",
          numeric: true,
          extra: true,
          sortValue: (r) => r.odds?.byePct ?? null,
          cell: (r) => (r.odds ? formatOdds(r.odds.byePct) : "—"),
        },
        {
          key: "title",
          header: "Title",
          title: "Simulated chance of winning the title",
          numeric: true,
          extra: true,
          sortValue: (r) => r.odds?.titlePct ?? null,
          cell: (r) => (r.odds ? formatOdds(r.odds.titlePct) : "—"),
        },
        {
          key: "last",
          header: "Last",
          title: "Simulated chance of finishing last",
          numeric: true,
          extra: true,
          sortValue: (r) => r.odds?.lastPct ?? null,
          cell: (r) => (r.odds ? formatOdds(r.odds.lastPct) : "—"),
        },
      ]
    : [];

  const columns: Column<StandingsRow>[] = [
    {
      key: "rank",
      header: "#",
      numeric: true,
      align: "left",
      sticky: { left: 0, width: 2.75 },
      sortValue: (r) => r.rank || null,
      firstDirection: "asc",
      cell: (r) => <span className="text-muted-foreground">{r.rank || "—"}</span>,
    },
    {
      key: "team",
      header: "Team",
      sticky: { left: 2.75, width: 8 },
      sortValue: (r) => r.teamName.toLowerCase(),
      firstDirection: "asc",
      cell: (r) => (
        <Link
          href={managerPath(r.managerName)}
          className="flex max-w-[8rem] items-center gap-2 hover:text-primary sm:max-w-[20rem]"
          title={`${r.teamName} — ${r.managerName}`}
        >
          <TeamAvatar name={r.managerName} imageUrl={r.avatarUrl} className="hidden h-7 w-7 shrink-0 sm:flex" />
          <span className="truncate font-semibold sm:hidden">{shortManagerName(r.managerName)}</span>
          <span className="hidden min-w-0 truncate sm:inline">
            <span className="font-semibold">{r.teamName}</span>
            <span className="text-muted-foreground"> · {shortManagerName(r.managerName)}</span>
          </span>
        </Link>
      ),
    },
    {
      key: "record",
      header: "W-L",
      numeric: true,
      align: "center",
      sortValue: winPct,
      cell: (r) => (
        <>
          {r.wins}-{r.losses}
          {r.ties ? `-${r.ties}` : ""}
          {r.tiebreak ? (
            <span
              className="ml-1 cursor-help text-[10px] text-muted-foreground"
              title={`Placed below the team above on ${r.tiebreak.toLowerCase()}`}
            >
              TB
            </span>
          ) : null}
        </>
      ),
    },
    {
      key: "pf",
      header: "PF",
      title: "Points for",
      numeric: true,
      sortValue: (r) => r.pointsFor,
      cell: (r) => r.pointsFor.toFixed(1),
    },
    {
      key: "pa",
      header: "PA",
      title: "Points against",
      numeric: true,
      sortValue: (r) => r.pointsAgainst,
      cell: (r) => <span className="text-muted-foreground">{r.pointsAgainst.toFixed(1)}</span>,
    },
    {
      key: "luck",
      header: "Luck",
      title: "Luck in wins: actual wins minus wins expected from scoring",
      numeric: true,
      sortValue: (r) => r.scheduleLuck ?? null,
      cell: (r) =>
        r.scheduleLuck != null ? (
          <span
            className={r.scheduleLuck > 0 ? "text-field" : r.scheduleLuck < 0 ? "text-destructive" : undefined}
            title={r.luckLabel ?? undefined}
          >
            {(r.scheduleLuck > 0 ? "+" : "") + r.scheduleLuck.toFixed(1)}
          </span>
        ) : (
          "—"
        ),
    },
    ...oddsColumns,
    {
      key: "allplay",
      header: "All-Play",
      title: "Record if you played every team every week",
      numeric: true,
      align: "center",
      extra: true,
      cell: (r) => r.allPlayRecord ?? "—",
    },
    {
      key: "xw",
      header: "Exp. W",
      title: "Wins expected from scoring",
      numeric: true,
      extra: true,
      sortValue: (r) => r.expectedWins ?? null,
      cell: (r) => r.expectedWins?.toFixed(1) ?? "—",
    },
    {
      key: "form",
      header: formLabel ?? "Form",
      align: "right",
      extra: true,
      cell: (r) =>
        r.recentForm && r.recentForm.length > 0 ? (
          <div className="flex justify-end">
            <FormChips form={r.recentForm} label={formLabel ?? "Form"} showLabel={false} />
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.fantasyTeamId}
      label="Standings"
      caption={caption}
      minWidth={hasOdds ? 1040 : 760}
      rowClassName={(r, i, sorted) => (!sorted && showCut && rankOf(r, i) === playoffTeams ? "cut-line" : undefined)}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {showCut ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-6 bg-primary/70" aria-hidden />
              Playoff line: top {playoffTeams} make the postseason
            </span>
          ) : (
            <span />
          )}
          <span>
            Order: win %, then points for. TB = placed by tiebreaker.
            {hasOdds ? ` Odds: 10,000 simulated seasons.${marks ? " x = clinched, e = eliminated." : ""}` : ""}
          </span>
        </div>
      }
    />
  );
}
