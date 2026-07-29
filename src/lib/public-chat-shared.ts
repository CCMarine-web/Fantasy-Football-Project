/**
 * Constants and types the public chat page shares between server and browser.
 *
 * These live outside `server/chat/public-chat.ts` on purpose. That module
 * imports Prisma, which imports `pg`, which requires node's `dns` — so a client
 * component importing anything from it (even a plain number) drags the whole
 * database driver into the browser bundle and the build fails with
 * "Can't resolve 'dns'". Keeping the shared surface in its own dependency-free
 * file means the client can import the limits without importing the server.
 */

/** Longest a self-entered display name may be. */
export const MAX_NAME_LENGTH = 24;

/** Longest a single message may be. */
export const MAX_BODY_LENGTH = 500;

/** Shortest usable display name. */
export const MIN_NAME_LENGTH = 2;

/** How many messages the feed shows. */
export const FEED_LIMIT = 100;

/** Longest a manager chat code may be. */
export const MAX_CHAT_CODE_LENGTH = 64;

/** A message as it is sent to the browser — no author hash, no moderation fields. */
export interface PublicChatMessageView {
  id: string;
  displayName: string;
  body: string;
  /**
   * True only when the poster presented a manager's personal chat code. The
   * browser shows the Verified Manager badge from this and nothing else — it is
   * never inferred from the name, because inferring it is exactly the hole this
   * closes.
   */
  isVerifiedManager: boolean;
  /** ISO 8601. */
  createdAt: string;
}
