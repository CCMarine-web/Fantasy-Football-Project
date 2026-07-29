import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { listAllPublicMessagesForAdmin } from "@/server/chat/public-chat";
import { listModerationRules } from "@/server/chat/identity";
import {
  blockChatNameAction,
  deleteChatMessageAction,
  hideChatMessageAction,
  muteChatAuthorAction,
  removeChatRuleAction,
  restoreChatMessageAction,
} from "./actions";
import { ChatCodeForm } from "./chat-code-form";
import { BadgeCheck, EyeOff, Eye, MessagesSquare, Trash2, VolumeX } from "lucide-react";

export const metadata = { title: "Moderate Chat" };

export const dynamic = "force-dynamic";

/**
 * Moderation screen for the PUBLIC chat page.
 *
 * Shows hidden messages alongside visible ones so a removal can be reviewed and
 * undone. `authorHash` is deliberately never displayed — it exists only for
 * rate limiting and muting, and showing it would serve no moderation purpose.
 * Muting works from a message rather than from an address for the same reason:
 * the address itself was never stored.
 */
export default async function AdminChatPage() {
  const session = await auth();
  if (session?.user?.role !== "ADMIN") {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <EmptyState
          title="Admins only"
          description="You need an admin account to moderate the chat."
        />
      </div>
    );
  }

  const [messages, rules, managers] = await Promise.all([
    listAllPublicMessagesForAdmin(),
    listModerationRules(),
    prisma.manager.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true, chatCodeHash: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  const visible = messages.filter((m) => !m.hiddenAt).length;
  const hidden = messages.length - visible;
  const blockedNames = rules.filter((r) => r.kind === "BLOCKED_NAME");
  const mutes = rules.filter((r) => r.kind === "MUTED_AUTHOR");

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Moderate Chat"
        description="The public chat room. Hiding is reversible; deleting is not. Manager names, team names and known aliases are reserved automatically — only a manager's own code can use one."
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="outline">{visible} visible</Badge>
        <Badge variant="secondary">{hidden} hidden</Badge>
        <Badge variant="outline">{blockedNames.length} blocked names</Badge>
        <Badge variant="outline">{mutes.length} muted posters</Badge>
      </div>

      {/* ── Manager codes ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-1 flex items-center gap-2 font-heading text-lg font-semibold tracking-wide uppercase">
          <BadgeCheck className="h-5 w-5" /> Manager Codes
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          A manager needs their code to post under their own name and to get the Verified Manager
          badge. A manager with no code has their name fully reserved: nobody can post as them at
          all, which is the safe default.
        </p>
        <ChatCodeForm
          managers={managers.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            hasCode: m.chatCodeHash != null,
          }))}
        />
      </section>

      {/* ── Blocked names ────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-1 font-heading text-lg font-semibold tracking-wide uppercase">
          Blocked Names
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          For names that are not a manager&rsquo;s but should still be refused. Stored normalised, so
          blocking one spelling blocks every decoration of it.
        </p>
        <form action={blockChatNameAction} className="flex flex-wrap items-center gap-2">
          <Input name="value" placeholder="Name to block" maxLength={64} className="sm:w-56" />
          <Input name="reason" placeholder="Reason (optional)" maxLength={200} className="sm:w-64" />
          <Button type="submit" size="sm" variant="outline">
            Block name
          </Button>
        </form>
        {blockedNames.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {blockedNames.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-mono">{rule.value}</span>
                  {rule.reason ? (
                    <span className="text-xs text-muted-foreground"> — {rule.reason}</span>
                  ) : null}
                </span>
                <form action={removeChatRuleAction}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button type="submit" className="text-xs text-primary hover:underline">
                    Unblock
                  </button>
                </form>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ── Mutes ────────────────────────────────────────────────────────── */}
      {mutes.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-1 font-heading text-lg font-semibold tracking-wide uppercase">
            Muted Posters
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Identified by the same one-way digest used for rate limiting. No address is stored, so
            there is nothing here to trace back to a person.
          </p>
          <ul className="space-y-1.5">
            {mutes.map((rule) => (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-card/30 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-muted-foreground">
                    {rule.value.slice(0, 10)}…
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {rule.expiresAt
                      ? `until ${rule.expiresAt.toISOString().slice(0, 16).replace("T", " ")} UTC`
                      : "indefinite"}
                  </span>
                </span>
                <form action={removeChatRuleAction}>
                  <input type="hidden" name="id" value={rule.id} />
                  <button type="submit" className="text-xs text-primary hover:underline">
                    Unmute
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="mb-3 font-heading text-lg font-semibold tracking-wide uppercase">Messages</h2>
        <div className="space-y-2">
          {messages.length === 0 ? (
            <EmptyState icon={MessagesSquare} title="No messages yet" />
          ) : (
            messages.map((message) => (
              <Card
                key={message.id}
                className={message.hiddenAt ? "border-destructive/40 bg-destructive/5" : undefined}
              >
                <CardContent className="flex flex-col gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold">{message.displayName}</span>
                      {message.verifiedManagerId ? (
                        <Badge className="bg-field text-field-foreground text-[10px]">
                          verified
                        </Badge>
                      ) : null}
                      <time
                        dateTime={message.createdAt.toISOString()}
                        className="text-muted-foreground text-[11px]"
                      >
                        {message.createdAt.toLocaleString()}
                      </time>
                      {message.hiddenAt ? (
                        <Badge variant="destructive" className="text-[10px]">
                          hidden by {message.hiddenBy ?? "admin"}
                          {message.hiddenReason ? ` — ${message.hiddenReason}` : ""}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-foreground/90 mt-1 text-sm break-words whitespace-pre-wrap">
                      {message.body}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <form action={message.hiddenAt ? restoreChatMessageAction : hideChatMessageAction}>
                      <input type="hidden" name="id" value={message.id} />
                      <Button
                        type="submit"
                        variant={message.hiddenAt ? "outline" : "secondary"}
                        size="sm"
                      >
                        {message.hiddenAt ? (
                          <>
                            <Eye className="h-4 w-4" /> Restore
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-4 w-4" /> Hide
                          </>
                        )}
                      </Button>
                    </form>

                    <form action={muteChatAuthorAction} className="flex items-center gap-1">
                      <input type="hidden" name="id" value={message.id} />
                      <input
                        type="number"
                        name="hours"
                        min={1}
                        max={8760}
                        placeholder="hrs"
                        aria-label="Mute duration in hours (blank for indefinite)"
                        className="h-8 w-16 rounded-md border border-input bg-background px-2 text-xs"
                      />
                      <Button type="submit" variant="outline" size="sm">
                        <VolumeX className="h-4 w-4" /> Mute poster
                      </Button>
                    </form>

                    <form action={blockChatNameAction}>
                      <input type="hidden" name="value" value={message.displayName} />
                      <input type="hidden" name="reason" value="blocked from the moderation screen" />
                      <Button type="submit" variant="outline" size="sm">
                        Block this name
                      </Button>
                    </form>

                    <form action={deleteChatMessageAction}>
                      <input type="hidden" name="id" value={message.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    </form>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
