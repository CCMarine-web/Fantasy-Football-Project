import { getMatchupById } from "@/server/repositories/matchup-repository";
import { BRAND } from "@/lib/branding";
import {
  brandCardResponse,
  fitFontSize,
  formatRecord,
  HEADING_FONT,
  Label,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  ogResponse,
  oneDecimal,
  Panel,
} from "@/lib/og/frame";

export const alt = `Matchup — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
/** Read per request: a game's card changes from preview to final. */
export const dynamic = "force-dynamic";

type Params = { season: string; week: string; matchupId: string };
type Matchup = NonNullable<Awaited<ReturnType<typeof getMatchupById>>>;
type Side = Matchup["teams"][number];

const STATUS_LABEL: Record<Matchup["status"], string> = {
  FINAL: "Final",
  IN_PROGRESS: "Live",
  SCHEDULED: "Preview",
};

function TeamSide({ team, final, result }: { team: Side; final: boolean; result: "won" | "lost" | "level" }) {
  const name = team.fantasyTeam.teamName.trim();
  const { wins, losses, ties } = team.fantasyTeam;
  const nameSize = fitFontSize(name, { width: 400, max: 64, min: 38, lines: 2 });
  const scoreColor = result === "won" ? OG_COLORS.accent : result === "lost" ? OG_COLORS.muted : OG_COLORS.text;

  return (
    <Panel style={{ flex: 1, alignItems: "center", textAlign: "center", padding: "26px 28px 22px" }}>
      <div
        style={{
          display: "block",
          lineClamp: 2,
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: nameSize,
          lineHeight: 1.06,
          textTransform: "uppercase",
          color: OG_COLORS.text,
        }}
      >
        {name}
      </div>
      <div style={{ display: "block", lineClamp: 1, marginTop: 8, fontSize: 28, color: OG_COLORS.muted }}>
        {team.fantasyTeam.manager.displayName}
      </div>
      <div style={{ display: "flex", flex: 1 }} />
      {final && team.score != null ? (
        <div style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 132, lineHeight: 1, color: scoreColor }}>
          {oneDecimal(team.score)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Label>Record</Label>
          <div style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 84, lineHeight: 1.05, color: OG_COLORS.text }}>
            {formatRecord(wins, losses, ties)}
          </div>
        </div>
      )}
    </Panel>
  );
}

export default async function Image({ params }: { params: Promise<Params> }) {
  let matchup: Matchup | null = null;
  try {
    const { season, week, matchupId } = await params;
    const m = await getMatchupById(matchupId);
    // The same checks the page makes before it will render this game.
    if (m && m.teams.length >= 2 && m.season.year === Number(season) && m.week === Number(week)) matchup = m;
  } catch (err) {
    console.error("[og] matchup card:", err);
  }
  if (!matchup) return brandCardResponse();

  const [a, b] = matchup.teams;
  /*
   * Scores appear only when the game is over, by the page's own rule: status
   * FINAL and a score on record for both sides (its share description uses
   * exactly this test). Scores are stored only for final weeks; a missing one
   * is never drawn as 0.0 — the card shows records instead.
   */
  const final = matchup.status === "FINAL" && a.score != null && b.score != null;
  const winner = final ? (a.isWinner ? a.id : b.isWinner ? b.id : null) : null;
  const resultFor = (t: Side) => (winner == null ? "level" : t.id === winner ? "won" : "lost");
  const tied = final && winner == null && a.score === b.score;

  // The round as the page names it ("Consolation bracket", "Championship").
  const round = matchup.roundName ?? (matchup.bracketType === "CONSOLATION" ? "Consolation" : null);
  const eyebrow = [`Week ${matchup.week}`, String(matchup.season.year), round].filter(Boolean).join(" · ");
  const status = tied ? "Final · Tie" : STATUS_LABEL[matchup.status];
  const statusColor = final ? OG_COLORS.accent : OG_COLORS.muted;

  return ogResponse(
    <OgFrame
      eyebrow={eyebrow}
      aside={
        <div
          style={{
            display: "flex",
            padding: "6px 18px",
            borderRadius: 999,
            border: `2px solid ${statusColor}`,
          }}
        >
          <Label color={statusColor} size={24}>
            {status}
          </Label>
        </div>
      }
    >
      <div style={{ display: "flex", flex: 1, alignItems: "stretch", gap: 20 }}>
        <TeamSide team={a} final={final} result={resultFor(a)} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 56 }}>
          <Label size={30}>vs</Label>
        </div>
        <TeamSide team={b} final={final} result={resultFor(b)} />
      </div>
    </OgFrame>,
  );
}
