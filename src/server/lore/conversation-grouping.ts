// Groups imported chat messages into conversations for knowledge extraction.
// A new conversation starts after a quiet gap (default 45 min) between
// consecutive messages. Pure + testable: messages in, conversation groups out.

export interface GroupableMessage {
  id: string;
  timestampMs: number;
  managerId: string | null;
  senderLabel: string;
  text: string;
  sourcePage: number | null;
}

export interface Conversation {
  index: number;
  startMs: number;
  endMs: number;
  messageIds: string[];
  participantManagerIds: string[];
  /** Compact transcript for the AI research packet (sender: text lines). */
  transcript: string;
  messageCount: number;
}

export interface GroupOptions {
  /** Minutes of silence that starts a new conversation. */
  gapMinutes: number;
  /** Max messages per conversation (keeps AI packets bounded). */
  maxMessages: number;
}

export function groupConversations(
  messages: GroupableMessage[],
  opts: GroupOptions = { gapMinutes: 45, maxMessages: 60 },
): Conversation[] {
  const sorted = [...messages].sort((a, b) => a.timestampMs - b.timestampMs);
  const gapMs = opts.gapMinutes * 60_000;
  const groups: GroupableMessage[][] = [];
  let current: GroupableMessage[] = [];

  for (const m of sorted) {
    const last = current[current.length - 1];
    const brokeGap = last && m.timestampMs - last.timestampMs > gapMs;
    const tooBig = current.length >= opts.maxMessages;
    if (current.length === 0 || (!brokeGap && !tooBig)) {
      current.push(m);
    } else {
      groups.push(current);
      current = [m];
    }
  }
  if (current.length) groups.push(current);

  return groups.map((g, index) => {
    const participants = [...new Set(g.map((m) => m.managerId).filter((x): x is string => !!x))];
    const transcript = g
      .map((m) => `${m.senderLabel}: ${m.text.replace(/\s+/g, " ").trim()}`)
      .filter((l) => l.length > 3)
      .join("\n");
    return {
      index,
      startMs: g[0].timestampMs,
      endMs: g[g.length - 1].timestampMs,
      messageIds: g.map((m) => m.id),
      participantManagerIds: participants,
      transcript,
      messageCount: g.length,
    };
  });
}
