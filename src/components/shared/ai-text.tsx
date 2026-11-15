import { Sparkles, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RenderedText } from "@/server/text/read";

/**
 * Every AI-written passage on the site, with its provenance.
 *
 *   "AI-generated · as of Week 9"   model prose written from that week's facts
 *   "From the stats · Week 9"        the templated fallback, shown when no AI
 *                                    text matches the current facts
 */
export function AiChip({ text, className }: { text: RenderedText; className?: string }) {
  const when = text.asOfWeek != null ? `Week ${text.asOfWeek}` : String(text.asOfSeason);
  const ai = text.source === "AI";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        ai ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
        className,
      )}
      title={ai ? `Written by ${text.model ?? "the AI"} from the verified numbers as of ${when}; key stats fill in live.` : "No AI write-up matches the current numbers yet, so this summary is assembled from the stats."}
    >
      {ai ? <Sparkles className="h-3 w-3" aria-hidden /> : <ListChecks className="h-3 w-3" aria-hidden />}
      {ai ? `AI-generated · as of ${when}` : `From the stats · ${when}`}
    </span>
  );
}

export function AiText({
  text,
  className,
  paragraphClassName,
  chip = "below",
}: {
  text: RenderedText | null | undefined;
  className?: string;
  paragraphClassName?: string;
  chip?: "above" | "below" | "none";
}) {
  if (!text) return null;
  const paragraphs = text.text.split(/\n\s*\n/).filter(Boolean);
  return (
    <div className={cn("space-y-2", className)}>
      {chip === "above" ? <AiChip text={text} /> : null}
      {paragraphs.map((p, i) => (
        <p key={i} className={cn("text-sm leading-relaxed text-foreground/90", paragraphClassName)}>
          {p}
        </p>
      ))}
      {chip === "below" ? <AiChip text={text} /> : null}
    </div>
  );
}
