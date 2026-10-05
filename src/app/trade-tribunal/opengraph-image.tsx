import { getTradeTribunal, isHeadlineTrade } from "@/server/repositories/trade-tribunal-repository";
import { BRAND } from "@/lib/branding";
import {
  HEADING_FONT,
  Label,
  OG_COLORS,
  OG_CONTENT_TYPE,
  OG_SIZE,
  OgFrame,
  ogResponse,
  Panel,
} from "@/lib/og/frame";

export const alt = `Trade Tribunal — ${BRAND.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
/** Read per request, so the count follows new trades rather than the last deploy. */
export const dynamic = "force-dynamic";

function Count({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <Panel style={{ padding: "16px 28px", minWidth: 250 }}>
      <div
        style={{
          fontFamily: HEADING_FONT,
          fontWeight: 600,
          fontSize: 76,
          lineHeight: 1.05,
          color: accent ? OG_COLORS.accent : OG_COLORS.text,
        }}
      >
        {String(value)}
      </div>
      <Label size={20}>{label}</Label>
    </Panel>
  );
}

export default async function Image() {
  // The same (cached) valuation the page reads; the card is still a card without it.
  let counts: { all: number; decided: number } | null = null;
  try {
    const trades = await getTradeTribunal();
    counts = { all: trades.length, decided: trades.filter(isHeadlineTrade).length };
  } catch (err) {
    console.error("[og] trade tribunal card:", err);
  }

  return ogResponse(
    <OgFrame
      eyebrow="The Court"
      title="Trade Tribunal"
      titleSize={96}
      subtitle="Every trade in league history, judged on what each player was actually worth at his position."
    >
      {counts && counts.all > 0 ? (
        <div style={{ display: "flex", flex: 1, alignItems: "flex-end", gap: 16 }}>
          <Count value={counts.all} label={counts.all === 1 ? "Trade judged" : "Trades judged"} />
          {/* The page's own split: the headline trades are the ones "someone actually won". */}
          <Count value={counts.decided} label="Someone actually won" accent />
        </div>
      ) : null}
    </OgFrame>,
  );
}
