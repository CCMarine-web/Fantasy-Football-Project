import { getRivalryDetail, type RivalryView } from "@/server/repositories/computed-rivalries-repository";
import { BRAND } from "@/lib/branding";
import {
  brandCardResponse,
  fitFontSize,
  HEADING_FONT,
  Label,
  managerPhotoSrc,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  ogResponse,
  Portrait,
} from "@/lib/og/frame";

export const alt = `Rivalry — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

function Side({ name, photo }: { name: string; photo: string | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: 18 }}>
      <Portrait src={photo} name={name} size={168} />
      <div
        style={{
          display: "block",
          lineClamp: 2,
          textAlign: "center",
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: fitFontSize(name, { width: 360, max: 52, min: 36, lines: 2 }),
          lineHeight: 1.08,
          textTransform: "uppercase",
          color: OG_COLORS.text,
        }}
      >
        {name}
      </div>
    </div>
  );
}

export default async function Image({ params }: { params: Promise<{ rivalryId: string }> }) {
  let r: RivalryView | null = null;
  try {
    const { rivalryId } = await params;
    r = await getRivalryDetail(rivalryId);
  } catch (err) {
    console.error("[og] rivalry card:", err);
  }
  if (!r) return brandCardResponse();

  const [photoA, photoB] = await Promise.all([managerPhotoSrc(r.managerAPhoto), managerPhotoSrc(r.managerBPhoto)]);
  // Whoever leads the series gets the accent; a level series is all white.
  const colorFor = (mine: number, theirs: number) =>
    mine > theirs ? OG_COLORS.accent : mine < theirs ? OG_COLORS.muted : OG_COLORS.text;
  const meetings = `${r.gamesPlayed} ${r.gamesPlayed === 1 ? "meeting" : "meetings"} on record`;

  return ogResponse(
    <OgFrame eyebrow={r.isOfficial ? "Official rivalry" : "Head to head"}>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 24 }}>
        <Side name={r.managerAName} photo={photoA} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 330 }}>
          <div style={{ display: "flex", alignItems: "baseline", fontFamily: HEADING_FONT, fontWeight: 600, lineHeight: 1 }}>
            <span style={{ fontSize: 132, color: colorFor(r.managerAWins, r.managerBWins) }}>{String(r.managerAWins)}</span>
            <span style={{ fontSize: 96, color: OG_COLORS.muted, margin: "0 18px" }}>–</span>
            <span style={{ fontSize: 132, color: colorFor(r.managerBWins, r.managerAWins) }}>{String(r.managerBWins)}</span>
          </div>
          <Label size={22}>{r.ties ? `Series record · ${r.ties} tied` : "Series record"}</Label>
          <div style={{ marginTop: 14, fontSize: 26, color: OG_COLORS.muted }}>{meetings}</div>
        </div>
        <Side name={r.managerBName} photo={photoB} />
      </div>
    </OgFrame>,
  );
}
