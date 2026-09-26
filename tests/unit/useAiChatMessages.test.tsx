import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { from, insertCalls, upsertOptions } = vi.hoisted(() => ({
  from: vi.fn(),
  insertCalls: [] as unknown[],
  upsertOptions: [] as unknown[],
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from },
}));

import { useAiChatMessages } from '@/hooks/useAiChatMessages';

/**
 * A PostgREST builder mock. It defines `then` only, like the real builder,
 * and returns itself from each chain method.
 */
function builder(result: { data: unknown; error: unknown }) {
  const b: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'single', 'maybeSingle']) {
    b[method] = vi.fn(() => b);
  }
  // Writes go through upsert, so a retry of the same row is a no-op.
  b.upsert = vi.fn((rows: unknown, options: unknown) => {
    insertCalls.push(rows);
    upsertOptions.push(options);
    return b;
  });
  b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useAiChatMessages', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    upsertOptions.length = 0;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    from.mockReset();
    from.mockImplementation(() => builder({ data: [], error: null }));
  });

  it('sends the client created_at of each row in saveMessagesBatch', async () => {
    const { result } = renderHook(() => useAiChatMessages('session-1'), { wrapper });

    await act(async () => {
      await result.current.saveMessagesBatch([
        { id: 'id-1', session_id: 'session-1', role: 'user', content: 'Q', created_at: '2026-09-26T10:00:00.001Z' },
        {
          id: 'id-2',
          session_id: 'session-1',
          role: 'assistant',
          content: '',
          created_at: '2026-09-26T10:00:00.002Z',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_kpis', arguments: '{}' } }],
        },
      ]);
    });

    expect(from).toHaveBeenCalledWith('ai_chat_messages');
    const rows = insertCalls.at(-1) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.created_at)).toEqual([
      '2026-09-26T10:00:00.001Z',
      '2026-09-26T10:00:00.002Z',
    ]);
    expect(rows[1].tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'get_kpis', arguments: '{}' } },
    ]);
  });

  it('sends the client created_at in saveMessage', async () => {
    from.mockImplementation(() => builder({ data: { id: 'db-1' }, error: null }));
    const { result } = renderHook(() => useAiChatMessages('session-1'), { wrapper });

    await act(async () => {
      await result.current.saveMessage({
        id: 'id-1',
        session_id: 'session-1',
        role: 'user',
        content: 'Q',
        created_at: '2026-09-26T10:00:00.001Z',
      });
    });

    const row = insertCalls.at(-1) as Record<string, unknown>;
    expect(row.created_at).toBe('2026-09-26T10:00:00.001Z');
  });

  it('leaves created_at out when the message has none, so the DB default applies', async () => {
    const { result } = renderHook(() => useAiChatMessages('session-1'), { wrapper });

    await act(async () => {
      await result.current.saveMessagesBatch([{ id: 'id-1', session_id: 'session-1', role: 'user', content: 'Q' }]);
    });

    const rows = insertCalls.at(-1) as Array<Record<string, unknown>>;
    expect(rows[0]).not.toHaveProperty('created_at');
  });

  it('sends the client id and ignores a duplicate id, so a retry is idempotent', async () => {
    const { result } = renderHook(() => useAiChatMessages('session-1'), { wrapper });

    await act(async () => {
      await result.current.saveMessagesBatch([
        { id: 'id-1', session_id: 'session-1', role: 'user', content: 'Q' },
        { id: 'id-2', session_id: 'session-1', role: 'assistant', content: 'A' },
      ]);
    });

    const rows = insertCalls.at(-1) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(['id-1', 'id-2']);
    expect(upsertOptions.at(-1)).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('sends the client id in saveMessage', async () => {
    from.mockImplementation(() => builder({ data: { id: 'id-1' }, error: null }));
    const { result } = renderHook(() => useAiChatMessages('session-1'), { wrapper });

    await act(async () => {
      await result.current.saveMessage({ id: 'id-1', session_id: 'session-1', role: 'user', content: 'Q' });
    });

    expect((insertCalls.at(-1) as Record<string, unknown>).id).toBe('id-1');
    expect(upsertOptions.at(-1)).toEqual({ onConflict: 'id', ignoreDuplicates: true });
  });

  it('invalidates the messages of the target session, not the current one', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAiChatMessages('session-current'), { wrapper });

    await act(async () => {
      await result.current.saveMessagesBatch([
        { id: 'id-1', session_id: 'session-old', role: 'user', content: 'Q' },
      ]);
    });

    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(['ai-chat-messages', 'session-old']);
    expect(keys).not.toContainEqual(['ai-chat-messages', 'session-current']);
  });
});
