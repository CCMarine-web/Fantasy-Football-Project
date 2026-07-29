import { PageHeader } from "@/components/shared/page-header";
import { ChatRoom } from "@/app/chat/chat-room";
import { listPublicMessages } from "@/server/chat/public-chat";
import { isDatabaseUnavailableError } from "@/lib/db";
import { Info } from "lucide-react";

export const metadata = {
  title: "Chat",
  description: "The Rat Trap's open chat — no account needed.",
};

/** A chat feed must never be served from a cache. */
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  let initialMessages: Awaited<ReturnType<typeof listPublicMessages>> = [];
  let unavailable = false;
  try {
    initialMessages = await listPublicMessages();
  } catch (error) {
    // Degrade to an empty room rather than a 500 — the client polls anyway.
    if (!isDatabaseUnavailableError(error)) throw error;
    unavailable = true;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Open Mic"
        title="Chat"
        description="Anyone with the link can post here — no account, no sign-in. Pick a name and go."
      />

      {/*
        The disclaimer now has to be precise rather than blanket: an unbadged
        name really is self-entered and proves nothing, but a badged one has
        been checked against a code only that manager holds. Saying "treat
        everything as anonymous" would understate the badge; saying "names are
        verified" would wildly overstate the rest.
      */}
      <div className="border-border/60 bg-muted/30 text-muted-foreground mt-6 flex items-start gap-2 rounded-md border px-4 py-3 text-sm">
        <Info className="text-primary mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Most names here are <strong className="text-foreground">self-entered</strong> and prove
          nothing — treat them as anonymous. Only a{" "}
          <strong className="text-foreground">Verified Manager</strong> badge means anything: it is
          shown when someone posted with the personal code the commissioner issued them. Manager
          names, team names and known aliases are reserved, so nobody can post as a league member
          without it. Be decent; the commissioner can hide, delete and mute. This is a public room
          and has nothing to do with the league&apos;s private group chat.
        </p>
      </div>

      {unavailable ? (
        <p className="border-border/60 bg-card/30 text-muted-foreground mt-6 rounded-md border border-dashed px-4 py-3 text-sm">
          Chat is temporarily unavailable. Refresh in a moment.
        </p>
      ) : (
        <ChatRoom initialMessages={initialMessages} />
      )}
    </div>
  );
}
