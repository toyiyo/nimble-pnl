import { describe, it, expect } from 'vitest';
import { mergeLoadedMessages, selectUnsavedMessages, titleForSession } from '@/lib/aiChatPersistence';
import type { ChatMessage } from '@/types/ai-chat';

const msg = (id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  content,
  ...extra,
});

describe('selectUnsavedMessages', () => {
  it('saves two tool-call assistant rows that both have empty content', () => {
    const messages = [
      msg('u1', 'user', 'Q'),
      msg('a1', 'assistant', '', { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] }),
      msg('t1', 'tool', '{}', { tool_call_id: 'c1' }),
      msg('a2', 'assistant', '', { tool_calls: [{ id: 'c2', type: 'function', function: { name: 'y', arguments: '{}' } }] }),
      msg('t2', 'tool', '{}', { tool_call_id: 'c2' }),
      msg('a3', 'assistant', 'Answer'),
    ];

    expect(selectUnsavedMessages(messages, new Set()).map((m) => m.id)).toEqual([
      'u1', 'a1', 't1', 'a2', 't2', 'a3',
    ]);
  });

  it('saves a message whose content and role equal an earlier saved message', () => {
    const messages = [msg('u1', 'user', 'Same'), msg('u2', 'user', 'Same')];
    expect(selectUnsavedMessages(messages, new Set(['u1'])).map((m) => m.id)).toEqual(['u2']);
  });

  it('does not save loaded rows again', () => {
    const loaded = [msg('db-1', 'user', 'Q'), msg('db-2', 'assistant', 'A')];
    const saved = new Set(loaded.map((m) => m.id));
    expect(selectUnsavedMessages([...loaded, msg('new-1', 'user', 'Q2')], saved).map((m) => m.id)).toEqual([
      'new-1',
    ]);
  });
});

describe('titleForSession', () => {
  it('gives a title when the session has exactly one user message, with tool rows', () => {
    const messages = [
      msg('u1', 'user', 'How are sales?'),
      msg('a1', 'assistant', ''),
      msg('t1', 'tool', '{}'),
      msg('a2', 'assistant', ''),
      msg('t2', 'tool', '{}'),
      msg('a3', 'assistant', 'Up 5%'),
    ];
    expect(titleForSession(messages)).toBe('How are sales?');
  });

  it('cuts a long title to 50 characters and adds an ellipsis', () => {
    const text = 'x'.repeat(60);
    expect(titleForSession([msg('u1', 'user', text)])).toBe(`${'x'.repeat(50)}...`);
  });

  it('does not split an emoji at the 50-character cut', () => {
    const text = `${'x'.repeat(49)}\u{1F600}${'y'.repeat(10)}`;
    const title = titleForSession([msg('u1', 'user', text)])!;
    expect(title).toBe(`${'x'.repeat(49)}\u{1F600}...`);
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('gives no title when the session has two user messages', () => {
    expect(titleForSession([msg('u1', 'user', 'A'), msg('a1', 'assistant', 'B'), msg('u2', 'user', 'C')])).toBeNull();
  });

  it('gives no title when the session has no user message', () => {
    expect(titleForSession([])).toBeNull();
  });
});

describe('mergeLoadedMessages', () => {
  it('keeps the loaded rows first and adds the current rows that are not loaded', () => {
    const loaded = [msg('db-1', 'user', 'Q'), msg('db-2', 'assistant', 'A')];
    const current = [msg('db-2', 'assistant', 'A'), msg('new-1', 'user', 'Q2'), msg('new-2', 'assistant', 'A2')];
    expect(mergeLoadedMessages(loaded, current).map((m) => m.id)).toEqual(['db-1', 'db-2', 'new-1', 'new-2']);
  });

  it('gives the loaded rows when no current row exists', () => {
    const loaded = [msg('db-1', 'user', 'Q')];
    expect(mergeLoadedMessages(loaded, [])).toEqual(loaded);
  });
});
