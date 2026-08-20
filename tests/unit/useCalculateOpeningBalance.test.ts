import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { useCalculateOpeningBalance } from '@/hooks/useCalculateOpeningBalance';

// A chainable thenable: every method returns the chain; awaiting it
// resolves to the canned response.
function chain(response: unknown) {
  // `any`: the Proxy returns itself from every property access, so its
  // real type is a self-reference TypeScript cannot express. The proxy
  // only stands in for the Supabase query builder's chained calls.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proxy: any = new Proxy(() => proxy, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) =>
          Promise.resolve(response).then(resolve);
      }
      return () => proxy;
    },
  });
  return proxy;
}

const EARLIEST_TS = '2026-02-02T03:30:00+00:00';

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    children,
  );
}

describe('useCalculateOpeningBalance entry day', () => {
  let insertedEntry: Record<string, unknown> | null;
  let upsertedBoundary: Record<string, unknown> | null;
  let tableCalls: Record<string, number>;

  beforeEach(() => {
    vi.clearAllMocks();
    insertedEntry = null;
    upsertedBoundary = null;
    tableCalls = {};

    mocks.from.mockImplementation((table: string) => {
      tableCalls[table] = (tableCalls[table] ?? 0) + 1;
      const n = tableCalls[table];
      if (table === 'bank_account_balances') {
        return chain({
          data: [{ current_balance: 1000, as_of_date: '2026-08-01' }],
          error: null,
        });
      }
      if (table === 'bank_transactions' && n === 1) {
        return chain({
          data: [{ amount: 200, transaction_date: EARLIEST_TS }],
          error: null,
        });
      }
      if (table === 'bank_transactions') {
        return chain({ data: { transaction_date: EARLIEST_TS }, error: null });
      }
      if (table === 'chart_of_accounts' && n === 1) {
        return chain({ data: { id: 'cash-id', account_name: 'Cash' }, error: null });
      }
      if (table === 'chart_of_accounts') {
        return chain({ data: { id: 'equity-id', account_name: 'Equity' }, error: null });
      }
      if (table === 'restaurants') {
        return chain({ data: { timezone: 'America/New_York' }, error: null });
      }
      if (table === 'journal_entries' && n === 1) {
        return chain({ data: null, error: null });
      }
      if (table === 'journal_entries') {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertedEntry = payload;
            return chain({ data: { id: 'je-id' }, error: null });
          },
        };
      }
      if (table === 'journal_entry_lines') {
        return { insert: () => chain({ error: null }) };
      }
      if (table === 'reconciliation_boundaries') {
        return {
          upsert: (payload: Record<string, unknown>) => {
            upsertedBoundary = payload;
            return chain({ error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    mocks.rpc.mockImplementation((fnName: string) => {
      if (fnName === 'bank_txn_entry_day') {
        return chain({ data: '2026-02-01', error: null });
      }
      if (fnName === 'rebuild_account_balances') {
        return chain({ data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${fnName}`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the opening date from the bank_txn_entry_day RPC', async () => {
    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });

    await result.current.mutateAsync('rest-1');

    expect(mocks.rpc).toHaveBeenCalledWith('bank_txn_entry_day', {
      p_ts: EARLIEST_TS,
      p_tz: 'America/New_York',
    });
    expect(insertedEntry?.entry_date).toBe('2026-02-01');
    expect(upsertedBoundary?.balance_start_date).toBe('2026-02-01');
  });

  it('falls back to today when no transaction exists', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z'));

    tableCalls = {};
    mocks.from.mockImplementation((table: string) => {
      tableCalls[table] = (tableCalls[table] ?? 0) + 1;
      const n = tableCalls[table];
      if (table === 'bank_account_balances') {
        return chain({
          data: [{ current_balance: 1000, as_of_date: '2026-08-01' }],
          error: null,
        });
      }
      if (table === 'bank_transactions' && n === 1) {
        return chain({ data: [], error: null });
      }
      if (table === 'bank_transactions') {
        return chain({ data: null, error: null });
      }
      if (table === 'chart_of_accounts' && n === 1) {
        return chain({ data: { id: 'cash-id', account_name: 'Cash' }, error: null });
      }
      if (table === 'chart_of_accounts') {
        return chain({ data: { id: 'equity-id', account_name: 'Equity' }, error: null });
      }
      if (table === 'journal_entries' && n === 1) {
        return chain({ data: null, error: null });
      }
      if (table === 'journal_entries') {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertedEntry = payload;
            return chain({ data: { id: 'je-id' }, error: null });
          },
        };
      }
      if (table === 'journal_entry_lines') {
        return { insert: () => chain({ error: null }) };
      }
      if (table === 'reconciliation_boundaries') {
        return {
          upsert: (payload: Record<string, unknown>) => {
            upsertedBoundary = payload;
            return chain({ error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    });

    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });

    await result.current.mutateAsync('rest-1');

    const rpcCallNames = mocks.rpc.mock.calls.map((call) => call[0]);
    expect(rpcCallNames).not.toContain('bank_txn_entry_day');
    expect(insertedEntry?.entry_date).toBe('2026-08-20');
  });
});
