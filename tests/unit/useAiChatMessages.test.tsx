import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { from, insertCalls } = vi.hoisted(() => ({
  from: vi.fn(),
  insertCalls: [] as unknown[],
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
  for (const method of ['select', 'eq', 'order', 'single']) {
    b[method] = vi.fn(() => b);
  }
  b.insert = vi.fn((rows: unknown) => {
    insertCalls.push(rows);
    return b;
  });
  b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return b;
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useAiChatMessages', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    from.mockReset();
    from.mockImplementation(() => builder({ data: [], error: null }));
  });

  it('sends the client created_at of each row in saveMessagesBatch', async () => {
    const { result } = renderHook(() => useAiChatMessages('session-1'), { wrapper });

    await act(async () => {
      await result.current.saveMessagesBatch([
        { session_id: 'session-1', role: 'user', content: 'Q', created_at: '2026-09-26T10:00:00.001Z' },
        {
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
      await result.current.saveMessagesBatch([{ session_id: 'session-1', role: 'user', content: 'Q' }]);
    });

    const rows = insertCalls.at(-1) as Array<Record<string, unknown>>;
    expect(rows[0]).not.toHaveProperty('created_at');
  });
});
