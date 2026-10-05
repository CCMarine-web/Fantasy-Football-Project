import { getSeasonHistory } from "@/server/repositories/history-repository";
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
  Panel,
} from "@/lib/og/frame";

export const alt = `Season history — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  UPCOMING: "Upcoming",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
};

type History = NonNullable<Awaited<ReturnType<typeof getSeasonHistory>>>;
type Team = History["season"]["fantasyTeams"][number];

const nameStyle = (size: number) =>
  ({
    display: "block",
    lineClamp: 1,
    fontFamily: HEADING_FONT,
    fontWeight: 600,
    fontSize: size,
    lineHeight: 1.12,
    textTransform: "uppercase",
    color: OG_COLORS.text,
  }) as const;

/** A secondary placing: who, with what team, and a figure. */
function Placing({ label, team, figure }: { label: string; team: Team; figure?: string }) {
  const name = team.manager.displayName;
  return (
    <Panel style={{ flex: 1, justifyContent: "center", padding: "14px 26px" }}>
      <Label size={19}>{label}</Label>
      <div style={nameStyle(fitFontSize(name, { width: 400, max: 44, min: 32, em: 0.52 }))}>{name}</div>
      <div style={{ display: "block", lineClamp: 1, fontSize: 23, color: OG_COLORS.muted }}>
        {figure ? `${team.teamName.trim()} · ${figure}` : team.teamName.trim()}
      </div>
    </Panel>
  );
}

/** The headline panel: the champion, or the best record while a season is being played. */
function Headline({ label, names, note, width }: { label: string; names: string[]; note: string; width: number }) {
  const text = names.join(" · ");
  return (
    <Panel style={{ flex: 1.25, justifyContent: "center", padding: "22px 32px" }}>
      <Label color={OG_COLORS.accent} size={22}>
        {label}
      </Label>
      <div
        style={{
          ...nameStyle(fitFontSize(text, { width, max: 76, min: 40, lines: 2, em: 0.52 })),
          lineClamp: 2,
          lineHeight: 1.06,
          marginTop: 4,
        }}
      >
        {text}
      </div>
      <div style={{ display: "block", lineClamp: 1, marginTop: 6, fontSize: 26, color: OG_COLORS.muted }}>{note}</div>
    </Panel>
  );
}

export default async function Image({ params }: { params: Promise<{ season: string }> }) {
  let data: History | null = null;
  try {
    const year = Number((await params).season);
    if (Number.isInteger(year)) data = await getSeasonHistory(year);
  } catch (err) {
    console.error("[og] season card:", err);
  }
  if (!data) return brandCardResponse();

  const { season } = data;
  const complete = season.status === "COMPLETE";
  // A champion is named only once the season is over.
  const championship = complete ? season.championship : null;
  const champion = championship?.championFantasyTeam ?? null;
  const runnerUp = championship?.runnerUpFantasyTeam ?? null;

  const teams = season.fantasyTeams;
  const played = teams.some((t) => t.wins + t.losses + t.ties > 0);
  // The page's standings order is regular-season rank, which is set once a season is decided.
  const leader = played ? (teams.find((t) => t.regularSeasonRank === 1) ?? null) : null;

  /*
   * While a season is being played there is no rank yet, only records — so the
   * card names whoever holds the best one (ties and all) rather than picking a
   * leader the standings have not.
   */
  const winPct = (t: Team) => {
    const g = t.wins + t.losses + t.ties;
    return g ? (t.wins + 0.5 * t.ties) / g : 0;
  };
  const best = played && !leader ? Math.max(...teams.map(winPct)) : null;
  const bestTeams = best != null ? teams.filter((t) => winPct(t) === best) : [];
  const bestRecord = bestTeams[0] ? formatRecord(bestTeams[0].wins, bestTeams[0].losses, bestTeams[0].ties) : "";

  const placings = [
    runnerUp ? { label: "Runner-up", team: runnerUp } : null,
    leader ? { label: "Regular-season No. 1", team: leader, figure: formatRecord(leader.wins, leader.losses, leader.ties) } : null,
  ].filter((p): p is { label: string; team: Team; figure?: string } => p !== null);

  // The headline panel shares the row with the placings, or has it to itself.
  const headlineWidth = placings.length > 0 ? 520 : 1000;

  return ogResponse(
    <OgFrame eyebrow={`Season · ${STATUS_LABEL[season.status] ?? season.status}`} title={`${season.year} Season`} titleSize={78}>
      <div style={{ display: "flex", flex: 1, gap: 16 }}>
        {champion ? (
          <Headline label="Champion" names={[champion.manager.displayName]} note={champion.teamName.trim()} width={headlineWidth} />
        ) : bestTeams.length > 0 && bestTeams.length <= 3 ? (
          <Headline
            label={`Best record · ${bestRecord}`}
            names={bestTeams.map((t) => t.manager.displayName)}
            note="No champion yet — the season is still being played."
            width={headlineWidth}
          />
        ) : (
          <div style={{ display: "flex", flex: 1, alignItems: "flex-end", fontSize: 28, color: OG_COLORS.muted }}>
            {complete
              ? "The final standings, the playoff bracket and the trades."
              : season.status === "UPCOMING"
                ? "The season has not kicked off yet."
                : "No champion yet — the season is still being played."}
          </div>
        )}
        {placings.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 16 }}>
            {placings.map((p) => (
              <Placing key={p.label} label={p.label} team={p.team} figure={p.figure} />
            ))}
          </div>
        ) : null}
      </div>
    </OgFrame>,
  );
}
