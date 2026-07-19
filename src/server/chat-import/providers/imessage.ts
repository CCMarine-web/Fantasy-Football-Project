// IMESSAGE parser — STUB. Unlike WhatsApp/GroupMe/Discord, iMessage has no
// single official export format: what a user hands us could be a raw
// `chat.db` SQLite dump, an `imessage-exporter` txt/html/pdf render, an
// iMazing CSV, or an AppleScript-generated transcript — each with different
// timestamp formats, quoting, and attachment conventions. Guessing wrong here
// would silently produce corrupted history rather than fail loudly, so this
// throws until a real export sample is available to build against.

import type { ChatParser } from "../types";
import { NotYetImplementedError } from "../errors";

export const iMessageParser: ChatParser = {
  platform: "IMESSAGE",

  parse(): never {
    throw new NotYetImplementedError(
      "iMessage parser stub — implement once a real export sample is available. " +
        "iMessage has no single official export format (varies by tool: imessage-exporter, iMazing, AppleScript transcripts, chat.db dumps, etc.), so a best-effort guess risks silently producing wrong data."
    );
  },
};
