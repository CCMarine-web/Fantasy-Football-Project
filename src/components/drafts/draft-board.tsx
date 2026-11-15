import Link from "next/link";
import { managerPath } from "@/lib/slug";
import { heatColor, positionColor } from "@/lib/chart-theme";
import { cn } from "@/lib/utils";
import type { DraftBoard as DraftBoardData, DraftBoardCell } from "@/server/repositories/draft-repository";
import type { PickReturn } from "@/server/repositories/draft-grade-repository";
import { draftsHref } from "@/components/drafts/draft-tabs";
import { Info } from "lucide-react";

export type BoardView = "position" | "hindsight";

const POSITION_LEGEND = [
  { label: "QB", code: "QB" },
  { label: "RB", code: "RB" },
  { label: "WR", code: "WR" },
  { label: "TE", code: "TE" },
  { label: "K / D/ST", code: "K" },
];

/**
 * How many draft slots of over- or under-production saturate the hindsight
 * colour: half the board. A pick that beat its slot by that much is as stolen
 * as a pick can look; one that missed by that much is as busted.
 */
function hindsightScale(pickCount: number): number {
  return Math.max(10, Math.round(pickCount / 2));
}

function hindsightValue(delta: number, scale: number): number {
  return 50 + 50 * Math.max(-1, Math.min(1, delta / scale));
}

function signed(n: number): string {
  return `${n > 0 ? "+" : ""}${n}`;
}

function verdict(delta: number): string {
  if (delta >= 10) return "steal";
  if (delta <= -10) return "bust";
  return "about par";
}

function Cell({
  cell,
  view,
  ret,
  scale,
  teamCount,
}: {
  cell: DraftBoardCell;
  view: BoardView;
  ret: PickReturn | undefined;
  scale: number;
  teamCount: number;
}) {
  const color = positionColor(cell.positionTag === "D/ST" ? "DEF" : cell.position);
  const pickLabel = `${cell.round}.${String(cell.pickInRound).padStart(teamCount >= 10 ? 2 : 1, "0")}`;
  const hindsight = view === "hindsight" && ret;
  const style = hindsight
    ? { background: heatColor(hindsightValue(ret.valueDelta, scale)) }
    : { background: `${color}2b`, boxShadow: `inset 3px 0 0 ${color}` };
  const title = [
    `Pick ${cell.pickNumber} (${pickLabel}): ${cell.playerName}, ${cell.positionTag}${cell.nflTeam ? ` · ${cell.nflTeam}` : ""}`,
    cell.isKeeper ? "Keeper" : null,
    cell.pickedBy ? `Picked by ${cell.pickedBy}` : null,
    ret
      ? ret.totalPoints != null
        ? `${ret.totalPoints} pts in ${ret.gamesPlayed} game${ret.gamesPlayed === 1 ? "" : "s"} (${ret.pointsPerGame} per game${ret.aboveReplacement != null ? `, ${signed(ret.aboveReplacement)} above replacement` : ""}) · ${signed(ret.valueDelta)} slots vs where he was taken`
        : `No points on record · ${signed(ret.valueDelta)} slots vs where he was taken`
      : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <td className="p-0 align-top">
      <div
        className={cn(
          "flex h-full min-h-[4.25rem] w-[7.5rem] flex-col gap-0.5 rounded px-1.5 py-1 sm:w-[8.5rem]",
          hindsight ? "text-white" : "text-foreground",
        )}
        style={style}
        title={title}
      >
        <span className={cn("flex items-center justify-between font-mono text-[10px]", hindsight ? "text-white/80" : "text-muted-foreground")}>
          <span>{pickLabel}</span>
          {cell.isKeeper ? (
            <span className="rounded border border-current px-1 text-[9px] font-semibold tracking-wide" title="Keeper">
              KEEP
            </span>
          ) : null}
        </span>
        <span className="line-clamp-2 text-[12px] leading-tight font-semibold break-words">{cell.playerName}</span>
        <span className={cn("mt-auto text-[10px]", hindsight ? "text-white/85" : "text-muted-foreground")}>
          {hindsight ? (
            <>
              <span className="font-mono font-semibold">{signed(ret.valueDelta)}</span>
              {" · "}
              {ret.totalPoints != null ? `${ret.pointsPerGame} ppg` : "no score"}
              <span className="sr-only">, {verdict(ret.valueDelta)}</span>
            </>
          ) : (
            <>
              <span className="font-semibold" style={{ color }}>
                {cell.positionTag}
              </span>
              {cell.nflTeam ? ` · ${cell.nflTeam}` : ""}
            </>
          )}
        </span>
      </div>
    </td>
  );
}

/**
 * The draft board as it looked in the room: a column per team in round-1
 * order, a row per round, snaking. Scrolls sideways inside its own box on a
 * phone, with the round column pinned.
 */
export function DraftBoard({
  board,
  view,
  hindsight,
  hindsightNote,
}: {
  board: DraftBoardData;
  view: BoardView;
  hindsight: { picks: Map<number, PickReturn>; throughWeek: number | null; replacement?: string } | null;
  /** Why hindsight colouring is not offered for this season, when it is not. */
  hindsightNote: string | null;
}) {
  const scale = hindsightScale(board.pickCount);
  const showHindsight = view === "hindsight" && hindsight != null;
  const teamCount = board.teams.length;

  // Biggest steal and bust, for the line above the board.
  let steal: { cell: DraftBoardCell; ret: PickReturn } | null = null;
  let bust: { cell: DraftBoardCell; ret: PickReturn } | null = null;
  if (showHindsight) {
    for (const row of board.rounds) {
      for (const cell of row.cells) {
        const ret = cell ? hindsight.picks.get(cell.pickNumber) : undefined;
        if (!cell || !ret) continue;
        if (!steal || ret.valueDelta > steal.ret.valueDelta) steal = { cell, ret };
        if (!bust || ret.valueDelta < bust.ret.valueDelta) bust = { cell, ret };
      }
    }
  }

  return (
    <section aria-labelledby="draft-board-heading" className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="draft-board-heading" className="font-heading text-lg font-semibold tracking-wide uppercase">
            {board.seasonYear} Draft Board
          </h2>
          <p className="text-xs text-muted-foreground">
            {board.teams.length} teams · {board.rounds.length} rounds · {board.pickCount} picks · snake order
          </p>
        </div>
        {hindsight ? (
          <div className="flex gap-1 rounded-md border border-border/60 p-0.5 text-xs" role="group" aria-label="Board colouring">
            {(
              [
                ["position", "By position"],
                ["hindsight", "Steal or bust"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={draftsHref("board", board.seasonYear, key)}
                aria-current={view === key ? "page" : undefined}
                className={cn(
                  "rounded px-2.5 py-1 font-medium",
                  view === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {/* Legend */}
      {showHindsight ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Bust</span>
            <span
              className="h-2.5 w-40 rounded-full"
              style={{
                background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(25)}, ${heatColor(50)}, ${heatColor(75)}, ${heatColor(100)})`,
              }}
              aria-hidden
            />
            <span>Steal</span>
          </div>
          <p>
            Each pick is coloured by how its player&rsquo;s points per game above replacement at his position{" "}
            {board.status === "IN_PROGRESS" && hindsight.throughWeek != null
              ? `so far (through Week ${hindsight.throughWeek}) `
              : ""}
            rank among everyone drafted, against the slot he was taken at — the same per-pick measure behind the
            revisited grade, and the Trade Tribunal&rsquo;s position adjustment, so a quarterback and a running back
            are compared on what each gave over a waiver-wire starter.
            {hindsight.replacement ? (
              <span className="mt-1 block">
                Replacement level, points per game: <span className="font-mono">{hindsight.replacement}</span>.
              </span>
            ) : null} The number is slots gained or lost (+20 means he has produced like a pick taken twenty
            spots earlier); the colour maxes out at ±{scale}.
            {board.status === "IN_PROGRESS" ? " Early-season numbers move a lot week to week." : ""}
          </p>
          {steal && bust ? (
            <p className="text-foreground/90">
              Biggest steal: <strong>{steal.cell.playerName}</strong> at pick {steal.cell.pickNumber} (
              {signed(steal.ret.valueDelta)}). Biggest bust: <strong>{bust.cell.playerName}</strong> at pick{" "}
              {bust.cell.pickNumber} ({signed(bust.ret.valueDelta)}).
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Position colours">
          {POSITION_LEGEND.map((p) => (
            <li key={p.code} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: positionColor(p.code) }} aria-hidden />
              {p.label}
            </li>
          ))}
        </ul>
      )}

      {hindsightNote ? (
        <p className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {hindsightNote}
        </p>
      ) : null}

      <div
        className="relative mt-3 overflow-x-auto rounded-lg border border-border/60 bg-card"
        role="region"
        aria-label={`${board.seasonYear} draft board, scrolls sideways`}
        tabIndex={0}
      >
        <table className="w-max border-separate border-spacing-1 text-left">
          <caption className="sr-only">
            {board.seasonYear} draft board: one column per team in first-round order, one row per round.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card px-1 text-[10px] font-medium text-muted-foreground uppercase">
                Rd
              </th>
              {board.teams.map((team) => (
                <th key={team.fantasyTeamId} scope="col" className="w-[7.5rem] px-1 pb-1 align-bottom sm:w-[8.5rem]">
                  {team.managerId ? (
                    <Link href={managerPath(team.managerName)} className="block truncate text-xs font-semibold hover:text-primary">
                      {team.managerName}
                    </Link>
                  ) : (
                    <span className="block truncate text-xs font-semibold">{team.managerName}</span>
                  )}
                  <span className="block truncate text-[10px] font-normal text-muted-foreground" title={team.teamName}>
                    {team.teamName}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rounds.map((row) => (
              <tr key={row.round}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-1 text-center font-mono text-xs font-semibold text-muted-foreground"
                >
                  {row.round}
                  <span className="block text-[10px] font-normal" aria-hidden>
                    {row.direction === "ltr" ? "→" : "←"}
                  </span>
                  <span className="sr-only">{row.direction === "ltr" ? ", left to right" : ", right to left"}</span>
                </th>
                {row.cells.map((cell, i) =>
                  cell ? (
                    <Cell
                      key={cell.pickNumber}
                      cell={cell}
                      view={view}
                      ret={showHindsight ? hindsight.picks.get(cell.pickNumber) : undefined}
                      scale={scale}
                      teamCount={teamCount}
                    />
                  ) : (
                    <td key={`empty-${i}`} className="p-0">
                      <div className="min-h-[4.25rem] w-[7.5rem] rounded border border-dashed border-border/50 sm:w-[8.5rem]" />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {showHindsight
          ? "Pick numbers read round.pick. Each pick shows its slots gained or lost and points per game; hover a pick for its season total."
          : "Pick numbers read round.pick; the colour is the position. Switch to Steal or bust for what each pick has produced."}
      </p>
    </section>
  );
}
