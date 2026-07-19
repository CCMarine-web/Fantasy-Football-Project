import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TeamAvatar } from "@/components/shared/team-avatar";
import { cn } from "@/lib/utils";
import type { StandingsRow } from "@/types/view-models";

function FormBadge({ result }: { result: "W" | "L" | "T" }) {
  return (
    <span
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-bold",
        result === "W" && "bg-field text-field-foreground",
        result === "L" && "bg-destructive/20 text-destructive",
        result === "T" && "bg-muted text-muted-foreground",
      )}
    >
      {result}
    </span>
  );
}

export function StandingsTable({ rows }: { rows: StandingsRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10">#</TableHead>
            <TableHead>Team</TableHead>
            <TableHead className="text-center">W-L-T</TableHead>
            <TableHead className="text-right">PF</TableHead>
            <TableHead className="text-right">PA</TableHead>
            <TableHead className="hidden text-center sm:table-cell">All-Play</TableHead>
            <TableHead className="hidden text-right md:table-cell">Exp. W</TableHead>
            <TableHead className="hidden text-right md:table-cell">Sched. Luck</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Form</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={row.fantasyTeamId}>
              <TableCell className="font-mono text-muted-foreground">{row.rank || i + 1}</TableCell>
              <TableCell>
                <Link
                  href={`/managers/${row.managerId}`}
                  className="flex items-center gap-3 hover:text-primary"
                >
                  <TeamAvatar name={row.managerName} imageUrl={row.avatarUrl} className="h-8 w-8" />
                  <span className="min-w-0">
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
              <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
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
