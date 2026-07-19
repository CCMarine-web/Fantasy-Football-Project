// Small helpers shared across platform parsers. Nothing here is
// platform-specific; each provider file owns its own format quirks.

import type { ParsedAttachment } from "../types";

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "avi", "mkv", "webm", "m4v", "3gp"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "opus", "m4a", "wav", "aac", "ogg", "caf", "amr"]);
const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"]);

/** Best-effort attachment type from a filename or URL's extension. */
export function inferAttachmentType(nameOrUrl: string | undefined | null): ParsedAttachment["type"] {
  if (!nameOrUrl) return "unknown";
  const withoutQuery = nameOrUrl.split(/[?#]/)[0];
  const ext = withoutQuery.split(".").pop()?.toLowerCase();
  if (!ext || ext === withoutQuery.toLowerCase()) return "unknown";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (DOCUMENT_EXTENSIONS.has(ext)) return "file";
  return "unknown";
}

/** Small ordered-set helper used by every parser to build participantIdentifiers. */
export class ParticipantCollector {
  private readonly seen = new Set<string>();
  private readonly ordered: string[] = [];

  add(identifier: string): void {
    if (!this.seen.has(identifier)) {
      this.seen.add(identifier);
      this.ordered.push(identifier);
    }
  }

  toArray(): string[] {
    return this.ordered;
  }
}
