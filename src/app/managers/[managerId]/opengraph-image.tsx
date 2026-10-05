import { getManagerProfileDetailed } from "@/server/repositories/manager-repository";
import { BRAND } from "@/lib/branding";
import {
  brandCardResponse,
  fitFontSize,
  formatRecord,
  HEADING_FONT,
  Label,
  managerPhotoSrc,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  ogResponse,
  Panel,
  Portrait,
} from "@/lib/og/frame";

export const alt = `Manager profile — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Panel style={{ flex: 1, padding: "18px 24px" }}>
      <Label size={20}>{label}</Label>
      <div style={{ fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 64, lineHeight: 1.1, color: OG_COLORS.text }}>
        {value}
      </div>
      {note ? <div style={{ fontSize: 22, color: OG_COLORS.muted }}>{note}</div> : null}
    </Panel>
  );
}

export default async function Image({ params }: { params: Promise<{ managerId: string }> }) {
  let profile: Awaited<ReturnType<typeof getManagerProfileDetailed>> = null;
  try {
    const { managerId } = await params;
    profile = await getManagerProfileDetailed(managerId);
  } catch (err) {
    console.error("[og] manager card:", err);
  }
  if (!profile) return brandCardResponse();

  // The same figures the profile page heads with (see its generateMetadata).
  const { manager, stats, eraStats, seasonLines } = profile;
  const currentTeam = manager.fantasyTeams[manager.fantasyTeams.length - 1];
  const career = eraStats.find((e) => e.key === "CAREER");
  const years = seasonLines
    .filter((l) => l.wins + l.losses + l.ties > 0)
    .map((l) => l.year)
    .sort((x, y) => x - y);
  const span = years.length
    ? years[0] === years[years.length - 1]
      ? `${years[0]}`
      : `${years[0]}–${years[years.length - 1]}`
    : undefined;
  const photo = await managerPhotoSrc(manager.photoUrl);
  const name = manager.displayName;

  return ogResponse(
    <OgFrame>
      <div style={{ display: "flex", flex: 1, alignItems: "center", gap: 48 }}>
        <Portrait src={photo} name={name} size={250} />
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div
            style={{
              display: "block",
              lineClamp: 1,
              fontFamily: HEADING_FONT,
              fontWeight: 600,
              fontSize: 30,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: OG_COLORS.accent,
            }}
          >
            {currentTeam?.teamName.trim() || "Free Agent"}
          </div>
          <div
            style={{
              display: "block",
              lineClamp: 2,
              marginTop: 2,
              fontFamily: HEADING_FONT,
              fontWeight: 600,
              fontSize: fitFontSize(name, { width: 760, max: 104, min: 64, lines: 1, em: 0.52 }),
              lineHeight: 1.05,
              textTransform: "uppercase",
              color: OG_COLORS.text,
            }}
          >
            {name}
          </div>
          {manager.nickname ? (
            <div style={{ display: "block", lineClamp: 1, marginTop: 4, fontSize: 28, color: OG_COLORS.muted }}>
              {`“${manager.nickname}”`}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 16, marginTop: 28 }}>
            {/* The page's Career row: regular season, consolation games excluded. */}
            <Stat
              label="Career record"
              value={career ? formatRecord(career.wins, career.losses, career.ties) : "—"}
              note="Regular season"
            />
            <Stat label="Titles" value={String(stats.championships)} />
            <Stat label="Seasons" value={String(years.length)} note={span} />
          </div>
        </div>
      </div>
    </OgFrame>,
  );
}
