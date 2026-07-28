import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/auth";
import { listAllPublicMessagesForAdmin } from "@/server/chat/public-chat";
import { hideChatMessageAction, restoreChatMessageAction } from "./actions";
import { EyeOff, Eye, MessagesSquare } from "lucide-react";

export const metadata = { title: "Moderate Chat" };

export const dynamic = "force-dynamic";

/**
 * Moderation screen for the PUBLIC chat page.
 *
 * Shows hidden messages alongside visible ones so a removal can be reviewed and
 * undone. `authorHash` is deliberately not displayed — it exists only for rate
 * limiting and showing it would serve no moderation purpose.
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

  const messages = await listAllPublicMessagesForAdmin();
  const visible = messages.filter((m) => !m.hiddenAt).length;
  const hidden = messages.length - visible;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Admin"
        title="Moderate Chat"
        description="The public chat room. Hiding is reversible — nothing is destroyed."
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="outline">{visible} visible</Badge>
        <Badge variant="secondary">{hidden} hidden</Badge>
      </div>

      <div className="mt-6 space-y-2">
        {messages.length === 0 ? (
          <EmptyState icon={MessagesSquare} title="No messages yet" />
        ) : (
          messages.map((message) => (
            <Card
              key={message.id}
              className={message.hiddenAt ? "border-destructive/40 bg-destructive/5" : undefined}
            >
              <CardContent className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold">{message.displayName}</span>
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

                <form
                  action={message.hiddenAt ? restoreChatMessageAction : hideChatMessageAction}
                  className="shrink-0"
                >
                  <input type="hidden" name="id" value={message.id} />
                  <Button
                    type="submit"
                    variant={message.hiddenAt ? "outline" : "destructive"}
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
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
