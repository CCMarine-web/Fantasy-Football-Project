// Shared error types for the chat-import subsystem. Thrown instead of
// letting a raw parse/validation failure leak out as an unstructured Error.

/**
 * Thrown by a ChatParser whose platform export format is not yet confidently
 * implemented (see providers/imessage.ts). Callers should surface this to
 * whoever built the upload UI rather than treating it as a normal parse bug.
 */
export class NotYetImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotYetImplementedError";
  }
}

/** Thrown when createChatImport() receives invalid/unsupported input (bad size, empty content, etc). */
export class ChatImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatImportValidationError";
  }
}

/** Thrown when a platform parser fails while parsing an otherwise-valid upload. */
export class ChatImportParseError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ChatImportParseError";
    this.cause = cause;
  }
}
