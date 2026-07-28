"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  MAX_BODY_LENGTH,
  MAX_NAME_LENGTH,
  MIN_NAME_LENGTH,
  type PublicChatMessageView,
} from "@/lib/public-chat-shared";
import { AlertCircle, Send } from "lucide-react";

/**
 * The public shoutbox.
 *
 * ── On escaping ───────────────────────────────────────────────────────────
 * Every message is rendered through ordinary JSX text interpolation
 * (`{message.body}`), which React escapes. There is no `dangerouslySetInnerHTML`
 * anywhere in this component, so a message containing markup or a script tag is
 * displayed as those literal characters. There is no sanitiser to defeat
 * because there is no HTML parsing path at all.
 *
 * ── On "real-time" ────────────────────────────────────────────────────────
 * The stack has no websocket layer, so this polls. Polling is paused while the
 * tab is hidden, which keeps an idle tab from making requests forever.
 */

const POLL_INTERVAL_MS = 5_000;
const NAME_STORAGE_KEY = "rat-trap-chat-name";

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMinutes = Math.round((now - date.getTime()) / 60_000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const sameDay = new Date().toDateString() === date.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** A stable colour per name, so the feed is easy to scan. */
function nameColor(name: string): string {
  const palette = [
    "text-sky-400",
    "text-emerald-400",
    "text-amber-400",
    "text-rose-400",
    "text-violet-400",
    "text-teal-400",
    "text-orange-400",
    "text-fuchsia-400",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length];
}

export function ChatRoom({ initialMessages }: { initialMessages: PublicChatMessageView[] }) {
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const shouldStickToBottom = useRef(true);

  /*
   * The name field is UNCONTROLLED on purpose.
   *
   * Restoring a remembered name has to happen after mount, because
   * localStorage does not exist during server rendering. Doing that with
   * `setState` inside an effect triggers a cascading render (and React's lint
   * rule rightly flags it); seeding the state directly would instead produce a
   * hydration mismatch, since the server rendered an empty field.
   *
   * Writing the value straight onto the input is exactly what an effect is for
   * — synchronising an external system, here the DOM — and sidesteps both
   * problems. The value is read back from the ref on submit.
   */
  useEffect(() => {
    const saved = window.localStorage.getItem(NAME_STORAGE_KEY);
    if (saved && nameRef.current && !nameRef.current.value) {
      nameRef.current.value = saved.slice(0, MAX_NAME_LENGTH);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: PublicChatMessageView[] };
      if (Array.isArray(data.messages)) setMessages(data.messages);
    } catch {
      // A failed poll is not worth surfacing; the next one will likely succeed.
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Follow new messages, but don't yank the view if the reader has scrolled up.
  useEffect(() => {
    const el = feedRef.current;
    if (el && shouldStickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = feedRef.current;
    if (!el) return;
    shouldStickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (sending) return;
    setError(null);

    const trimmedName = (nameRef.current?.value ?? "").trim();
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setError("Say something first.");
      return;
    }
    if (trimmedName.length < MIN_NAME_LENGTH) {
      setError(`Pick a name of at least ${MIN_NAME_LENGTH} characters.`);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: trimmedName, body: trimmedBody }),
      });
      const data = (await res.json()) as { message?: PublicChatMessageView; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not post that.");
        return;
      }
      window.localStorage.setItem(NAME_STORAGE_KEY, trimmedName);
      setBody("");
      shouldStickToBottom.current = true;
      if (data.message) setMessages((prev) => [...prev, data.message as PublicChatMessageView]);
      void refresh();
    } catch {
      setError("Network problem — try again.");
    } finally {
      setSending(false);
    }
  }

  const remaining = MAX_BODY_LENGTH - body.length;

  return (
    <div className="mt-6">
      <Card>
        <CardContent className="p-0">
          <div
            ref={feedRef}
            onScroll={onScroll}
            className="h-[60vh] min-h-80 overflow-y-auto px-4 py-4 sm:px-6"
            aria-live="polite"
            aria-label="Chat messages"
          >
            {messages.length === 0 ? (
              <p className="text-muted-foreground py-12 text-center text-sm">
                Nothing here yet. Be the first to say something.
              </p>
            ) : (
              <ul className="space-y-3">
                {messages.map((message) => (
                  <li key={message.id} className="text-sm">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {/* Interpolated as text — React escapes it. */}
                      <span className={`font-semibold ${nameColor(message.displayName)}`}>
                        {message.displayName}
                      </span>
                      <time
                        dateTime={message.createdAt}
                        className="text-muted-foreground text-[11px]"
                        suppressHydrationWarning
                      >
                        {formatTime(message.createdAt)}
                      </time>
                    </div>
                    <p className="text-foreground/90 mt-0.5 break-words whitespace-pre-wrap">
                      {message.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form onSubmit={submit} className="border-border/60 border-t p-4 sm:px-6">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                ref={nameRef}
                placeholder="Your name"
                maxLength={MAX_NAME_LENGTH}
                aria-label="Display name"
                className="sm:w-44"
                autoComplete="off"
              />
              <Input
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
                placeholder="Say something…"
                maxLength={MAX_BODY_LENGTH}
                aria-label="Message"
                className="flex-1"
                autoComplete="off"
              />
              <Button type="submit" disabled={sending} className="shrink-0">
                <Send className="h-4 w-4" />
                {sending ? "Sending…" : "Send"}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-muted-foreground text-[11px]">
                {remaining < 80
                  ? `${remaining} characters left`
                  : `Up to ${MAX_BODY_LENGTH} characters`}
              </p>
              {error ? (
                <p role="alert" className="text-destructive flex items-center gap-1 text-[13px]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {error}
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
