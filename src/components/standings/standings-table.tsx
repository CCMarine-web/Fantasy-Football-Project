import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { cn } from "@/lib/utils";
import type { StandingsRow } from "@/types/view-models";

function FormBadge({ result }: { result: "W" | "L" | "T" }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-sm text-[12px] font-bold",
        result === "W" && "bg-field text-field-foreground",
        result === "L" && "bg-destructive/20 text-destructive",
        result === "T" && "bg-muted text-muted-foreground",
      )}
    >
      {result}
    </span>
  );
}

/**
 * `caption` states what the order means. It is not decoration: before week 1
 * there are no standings, and a table that silently lists ten 0-0 teams as
 * positions 1 to 10 is telling every reader something untrue. When a row has no
 * recorded position the cell shows a dash rather than the row index.
 */
export function StandingsTable({ rows, caption }: { rows: StandingsRow[]; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      {caption ? (
        <p className="border-b border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
          {caption}
        </p>
      ) : null}
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-center">W-L-T</TableHead>
            <TableHead className="text-right">PF</TableHead>
            <TableHead className="hidden text-right sm:table-cell">PA</TableHead>
            <TableHead className="hidden text-center sm:table-cell">All-Play</TableHead>
            <TableHead className="hidden text-right md:table-cell">Exp. W</TableHead>
            <TableHead className="hidden text-right md:table-cell">Sched. Luck</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Form</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.fantasyTeamId}>
              <TableCell className="font-mono text-muted-foreground">{row.rank || "—"}</TableCell>
              <TableCell>
                <Link
                  href={`/managers/${row.managerId}`}
                  className="flex items-center gap-3 hover:text-primary"
                >
                  <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-8 w-8 shrink-0" />
                  {/* A max-width is required for `truncate` to engage: without
                      one the cell takes its intrinsic content width, which held
                      the table at 431px and clipped the points columns
                      mid-number on any phone. */}
                  <span className="min-w-0 max-w-[7rem] sm:max-w-none">
                    <span className="block truncate text-sm font-semibold">{row.teamName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.managerName}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell className="text-center font-mono tabular-nums">
                {row.wins}-{row.losses}
                {row.ties ? `-${row.ties}` : ""}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {row.pointsFor.toFixed(1)}
              </TableCell>
              {/* Points-against joins the progressively-disclosed columns: at
                  phone widths there is not room for both points columns, and a
                  half-visible number reads as a rendering bug. */}
              <TableCell className="hidden text-right font-mono tabular-nums text-muted-foreground sm:table-cell">
                {row.pointsAgainst.toFixed(1)}
              </TableCell>
              <TableCell className="hidden text-center font-mono tabular-nums sm:table-cell">
                {row.allPlayRecord ?? "—"}
              </TableCell>
              <TableCell className="hidden text-right font-mono tabular-nums md:table-cell">
                {row.expectedWins?.toFixed(1) ?? "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "hidden text-right font-mono tabular-nums md:table-cell",
                  (row.scheduleLuck ?? 0) > 0 && "text-field",
                  (row.scheduleLuck ?? 0) < 0 && "text-destructive",
                )}
              >
                {row.scheduleLuck != null ? (row.scheduleLuck > 0 ? "+" : "") + row.scheduleLuck.toFixed(1) : "—"}
              </TableCell>
              <TableCell className="hidden lg:table-cell">
                <div className="flex justify-end gap-1">
                  {row.recentForm && row.recentForm.length > 0 ? (
                    row.recentForm.map((r, idx) => <FormBadge key={idx} result={r} />)
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
