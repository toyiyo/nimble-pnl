import type { ChatMessage } from '@/types/ai-chat';

const TITLE_MAX_LENGTH = 50;

/**
 * Returns the messages that the panel must still save.
 * The rule uses the message ID only. The rule saves two rows with the same
 * role and content, for example two tool-call rows with content ''.
 */
export function selectUnsavedMessages(
  messages: ChatMessage[],
  savedIds: ReadonlySet<string>
): ChatMessage[] {
  return messages.filter((m) => !savedIds.has(m.id));
}

/**
 * Returns a session title when the session has exactly one user message.
 * Returns null in all other cases.
 */
export function titleForSession(messages: ChatMessage[]): string | null {
  const userMessages = messages.filter((m) => m.role === 'user');
  if (userMessages.length !== 1) return null;
  // Count code points, not UTF-16 units, so the cut cannot split an emoji.
  const chars = Array.from(userMessages[0].content);
  const head = chars.slice(0, TITLE_MAX_LENGTH).join('');
  return chars.length > TITLE_MAX_LENGTH ? `${head}...` : head;
}

/**
 * Merges the rows loaded from the database with the rows in the chat.
 * The loaded rows come first. A chat row that is not in the database yet
 * (a turn that the panel did not save yet) stays after them.
 */
export function mergeLoadedMessages(loaded: ChatMessage[], current: ChatMessage[]): ChatMessage[] {
  const loadedIds = new Set(loaded.map((m) => m.id));
  return [...loaded, ...current.filter((m) => !loadedIds.has(m.id))];
}
