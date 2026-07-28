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
        Required disclaimer: names are self-entered and prove nothing. Stated
        plainly rather than buried, because the whole page is anonymous.
      */}
      <div className="border-border/60 bg-muted/30 text-muted-foreground mt-6 flex items-start gap-2 rounded-md border px-4 py-3 text-sm">
        <Info className="text-primary mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Names here are <strong className="text-foreground">self-entered and unverified</strong>
          {" — "}anyone can type anything, so treat every message as anonymous. Be decent; the
          commissioner can remove posts. This is a public room and has nothing to do with the
          league&apos;s private group chat.
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
