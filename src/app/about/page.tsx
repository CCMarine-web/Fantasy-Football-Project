import Link from "next/link";
import { PageHeader } from "@/components/shared/page-header";
import { pageMetadata } from "@/lib/indexing";

export const metadata = pageMetadata("/about", {
  title: "About the League",
  description:
    "About The Rat Trap Fantasy Football League: a ten-manager league founded in 2017, and the site that keeps its standings, records and history.",
});

/** Static, crawlable text: no data, no client code. */
export const dynamic = "force-static";

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader eyebrow="The League" title="About" />
      <div className="mt-6 max-w-2xl space-y-4 text-base leading-relaxed">
        <p>
          <strong>The Rat Trap Fantasy Football League</strong> — Rat Trap Fantasy, or Rat Trap Fantasy Football
          to anyone keeping it formal — was founded in 2017. It started with eight teams and has run with ten
          managers every season since, first on ESPN and, from 2023, on Sleeper.
        </p>
        <p>
          This site is the league&rsquo;s permanent record. It keeps the live{" "}
          <Link href="/standings" className="text-primary hover:underline">standings</Link> and playoff odds, weekly{" "}
          <Link href="/power-rankings" className="text-primary hover:underline">power rankings</Link>, matchups and
          recaps, every trade and waiver claim, head-to-head rivalries, draft grades, the{" "}
          <Link href="/records" className="text-primary hover:underline">record book</Link>, the{" "}
          <Link href="/championship-belt" className="text-primary hover:underline">championship belt</Link> and a{" "}
          <Link href="/history" className="text-primary hover:underline">season-by-season history</Link> back to
          the first draft.
        </p>
        <p>
          Numbers come straight from the league&rsquo;s scoring data and are refreshed through the season. The
          commentary is written for the group chat, so it is about as polite as the group chat.
        </p>
      </div>
    </div>
  );
}
