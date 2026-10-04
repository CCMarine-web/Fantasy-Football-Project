import { redirect } from "next/navigation";

/**
 * This was a static mock of the chat import flow ("not yet wired to a live
 * parser in this build", sample people and all). The real flow is
 * /admin/chat-import; old links land there. Still admin-only via src/proxy.ts.
 */
export default function ChatLorePage() {
  redirect("/admin/chat-import");
}
