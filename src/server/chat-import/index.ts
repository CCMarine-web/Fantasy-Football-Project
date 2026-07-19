// Public surface of the chat-import subsystem. Consumers outside this
// folder (admin UI, review pages, AI generation code) should import from
// here rather than reaching into ./providers or individual files directly.

export type { ParsedAttachment, CanonicalParsedMessage, ParseResult, ChatParser } from "./types";
export { NotYetImplementedError, ChatImportValidationError, ChatImportParseError } from "./errors";
export { getParserForPlatform } from "./registry";
export {
  createChatImport,
  MAX_CHAT_IMPORT_FILE_SIZE_BYTES,
  type CreateChatImportInput,
  type CreateChatImportResult,
} from "./import-service";
export {
  getApprovedContextForGeneration,
  type ApprovedContextFilter,
  type ApprovedContextMessage,
} from "./context-retrieval";
