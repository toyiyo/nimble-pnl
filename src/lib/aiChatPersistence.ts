import type { ChatMessage } from '@/types/ai-chat';

const TITLE_MAX_LENGTH = 50;

/**
 * Returns the messages that the panel must still save.
 * The rule uses the message ID only. Two rows with the same role and
 * content (for example two tool-call rows with content '') are both saved.
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
  const text = userMessages[0].content;
  return text.length > TITLE_MAX_LENGTH ? `${text.slice(0, TITLE_MAX_LENGTH)}...` : text;
}
