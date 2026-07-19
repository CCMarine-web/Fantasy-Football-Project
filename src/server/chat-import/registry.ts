// Maps every ChatPlatform enum value to its parser implementation. Adding a
// new platform means writing one ./providers/<platform>.ts file and adding
// one line here — nothing else in this module should need to change.

import type { ChatPlatform } from "@/generated/prisma/client";
import type { ChatParser } from "./types";
import { plainTextParser } from "./providers/plain-text";
import { whatsAppParser } from "./providers/whatsapp";
import { iMessageParser } from "./providers/imessage";
import { groupMeParser } from "./providers/groupme";
import { discordParser } from "./providers/discord";
import { csvParser } from "./providers/csv";
import { jsonParser } from "./providers/json";

const PARSER_REGISTRY: Record<ChatPlatform, ChatParser> = {
  IMESSAGE: iMessageParser,
  WHATSAPP: whatsAppParser,
  GROUPME: groupMeParser,
  DISCORD: discordParser,
  PLAIN_TEXT: plainTextParser,
  CSV: csvParser,
  JSON: jsonParser,
};

export function getParserForPlatform(platform: ChatPlatform): ChatParser {
  const parser = PARSER_REGISTRY[platform];
  if (!parser) {
    throw new Error(`No chat parser registered for platform "${platform}".`);
  }
  return parser;
}
