import { describe, it, expect } from 'vitest';
import { selectUnsavedMessages, titleForSession } from '@/lib/aiChatPersistence';
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

  it('gives no title when the session has two user messages', () => {
    expect(titleForSession([msg('u1', 'user', 'A'), msg('a1', 'assistant', 'B'), msg('u2', 'user', 'C')])).toBeNull();
  });

  it('gives no title when the session has no user message', () => {
    expect(titleForSession([])).toBeNull();
  });
});
