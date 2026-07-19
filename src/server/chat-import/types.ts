// Group-chat lore ingestion — provider-agnostic parser architecture.
//
// The whole point of this module is that ~5 years of chat history can arrive
// in whatever export format a given platform happens to produce, and every
// one of those formats gets normalized into the single CanonicalParsedMessage
// shape below BEFORE anything talks to Prisma or does manager-linking. Add a
// new platform by writing one more ChatParser in ./providers and registering
// it in ./registry.ts — nothing else in this module should need to change.
//
// IMPORTANT (safety constraint carried through the whole design): raw chat
// archives must NEVER be sent wholesale to an AI provider. See
// ./context-retrieval.ts for the one sanctioned, narrowly-scoped read path.

/** One attachment referenced by a chat message, as best the parser can tell. */
export interface ParsedAttachment {
  type: "image" | "video" | "audio" | "file" | "link" | "unknown";
  filename?: string;
  url?: string;
}

/**
 * The canonical parsed-message shape every platform parser must produce.
 * This is the parser's raw output — still using string participant
 * identifiers exactly as they appear in the raw export (e.g. a phone number,
 * a display name, a platform user id), not DB ids. Resolving
 * `senderRawIdentifier` to a `Manager` is a manual admin-UI step built
 * elsewhere, not something a parser does.
 */
export interface CanonicalParsedMessage {
  timestamp: Date;
  /** As it appears in the raw export, mapped to a Manager later. */
  senderRawIdentifier: string;
  text: string | null;
  attachments: ParsedAttachment[];
  /** Some platform-native id/index this message replies to, if the export encodes that. */
  replyToRawId?: string;
  sourcePlatform: "IMESSAGE" | "WHATSAPP" | "GROUPME" | "DISCORD" | "PLAIN_TEXT" | "CSV" | "JSON";
  /** Original message id/index from the export, if present, for building reply graphs. */
  rawId?: string;
}

/** Everything a single parse() call learns about one uploaded export. */
export interface ParseResult {
  messages: CanonicalParsedMessage[];
  /** Deduped list of every distinct sender seen, in first-seen order. */
  participantIdentifiers: string[];
  /** Non-fatal issues encountered while parsing (skipped lines, ambiguous timestamps, etc.). */
  warnings: string[];
}

/** Implemented once per supported chat export platform. See ./registry.ts. */
export interface ChatParser {
  platform: CanonicalParsedMessage["sourcePlatform"];
  parse(input: string): ParseResult | Promise<ParseResult>;
}
