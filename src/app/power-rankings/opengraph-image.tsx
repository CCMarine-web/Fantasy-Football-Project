import { getPowerRankings, type PowerRankingView } from "@/server/repositories/power-rankings-repository";
import { BRAND } from "@/lib/branding";
import {
  brandCardResponse,
  fitFontSize,
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

export const alt = `Power Rankings — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
/** Read per request, so the card moves with the weekly refresh rather than the last deploy. */
export const dynamic = "force-dynamic";

function Row({ row }: { row: PowerRankingView }) {
  const team = row.teamName.trim();
  return (
    <Panel style={{ flexDirection: "row", alignItems: "center", gap: 24, padding: "8px 28px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          width: 56,
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: 54,
          lineHeight: 1,
          color: row.rank === 1 ? OG_COLORS.accent : OG_COLORS.muted,
        }}
      >
        {String(row.rank)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div
          style={{
            display: "block",
            lineClamp: 1,
            fontFamily: HEADING_FONT,
            fontWeight: 600,
            fontSize: fitFontSize(team, { width: 760, max: 40, min: 32 }),
            lineHeight: 1.15,
            textTransform: "uppercase",
            color: OG_COLORS.text,
          }}
        >
          {team}
        </div>
        <div style={{ display: "block", lineClamp: 1, fontSize: 24, color: OG_COLORS.muted }}>{row.managerName}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
        <div style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 50, lineHeight: 1, color: OG_COLORS.accent }}>
          {oneDecimal(row.score)}
        </div>
        <Label size={16}>Power score</Label>
      </div>
    </Panel>
  );
}

export default async function Image() {
  let data: Awaited<ReturnType<typeof getPowerRankings>> = null;
  try {
    data = await getPowerRankings();
  } catch (err) {
    console.error("[og] power rankings card:", err);
  }
  if (!data || data.rows.length === 0) return brandCardResponse();

  // The page's own three states, named the way the page names them.
  const title =
    data.mode === "IN_SEASON"
      ? "Power Rankings"
      : data.mode === "MANAGER_BASELINE"
        ? "Manager Baseline Rankings"
        : "Preseason Power Rankings";
  const eyebrow =
    data.mode === "IN_SEASON"
      ? `${data.seasonYear} · Through Week ${data.throughWeek}`
      : `${data.seasonYear} · ${data.mode === "MANAGER_BASELINE" ? "Before the draft" : "After the draft"}`;

  return ogResponse(
    <OgFrame eyebrow={eyebrow} title={title} titleSize={60}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "flex-end", gap: 10 }}>
        {data.rows.slice(0, 3).map((row) => (
          <Row key={row.fantasyTeamId} row={row} />
        ))}
      </div>
    </OgFrame>,
  );
}
