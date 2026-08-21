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

  // The from-mock throws on any table or extra call the hook must not
  // make. bank_transactions may be queried exactly once (the net-change
  // sum); the entry day comes from the min_bank_txn_entry_day RPC.
  function installFromMock() {
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
          data: [{ amount: 200, transaction_date: '2026-02-01T00:00:00+00:00' }],
          error: null,
        });
      }
      if (table === 'chart_of_accounts' && n === 1) {
        return chain({ data: { id: 'cash-id', account_name: 'Cash' }, error: null });
      }
      if (table === 'chart_of_accounts' && n === 2) {
        return chain({ data: { id: 'equity-id', account_name: 'Equity' }, error: null });
      }
      if (table === 'journal_entries' && n === 1) {
        return chain({ data: null, error: null });
      }
      if (table === 'journal_entries' && n === 2) {
        return {
          insert: (payload: Record<string, unknown>) => {
            insertedEntry = payload;
            return chain({ data: { id: 'je-id' }, error: null });
          },
        };
      }
      if (table === 'journal_entry_lines' && n === 1) {
        return { insert: () => chain({ error: null }) };
      }
      if (table === 'reconciliation_boundaries' && n === 1) {
        return {
          upsert: (payload: Record<string, unknown>) => {
            upsertedBoundary = payload;
            return chain({ error: null });
          },
        };
      }
      throw new Error(`unexpected query: ${table} call ${n}`);
    });
  }

  function installRpcMock(minEntryDayResponse: unknown) {
    mocks.rpc.mockImplementation((fnName: string) => {
      if (fnName === 'min_bank_txn_entry_day') {
        return chain(minEntryDayResponse);
      }
      if (fnName === 'rebuild_account_balances') {
        return chain({ data: null, error: null });
      }
      throw new Error(`unexpected rpc: ${fnName}`);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    insertedEntry = null;
    upsertedBoundary = null;
    installFromMock();
    installRpcMock({ data: '2026-01-31', error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives the opening date from the min_bank_txn_entry_day RPC', async () => {
    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });

    await result.current.mutateAsync('rest-1');

    // The RPC returns the minimum DERIVED day (2026-01-31), one local
    // day before the minimum raw timestamp's UTC day (2026-02-01). The
    // hook must use the RPC value, not order raw timestamps itself.
    expect(mocks.rpc).toHaveBeenCalledWith('min_bank_txn_entry_day', {
      p_restaurant_id: 'rest-1',
    });
    expect(insertedEntry?.entry_date).toBe('2026-01-31');
    expect(upsertedBoundary?.balance_start_date).toBe('2026-01-31');
  });

  it('falls back to today when the restaurant has no transaction', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-20T15:00:00Z'));
    installRpcMock({ data: null, error: null });

    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });

    await result.current.mutateAsync('rest-1');

    expect(mocks.rpc).toHaveBeenCalledWith('min_bank_txn_entry_day', {
      p_restaurant_id: 'rest-1',
    });
    expect(insertedEntry?.entry_date).toBe('2026-08-20');
  });

  it('throws when the entry-day RPC fails and writes nothing', async () => {
    installRpcMock({ data: null, error: new Error('rpc down') });

    const { result } = renderHook(() => useCalculateOpeningBalance(), { wrapper });

    await expect(result.current.mutateAsync('rest-1')).rejects.toThrow('rpc down');
    expect(insertedEntry).toBeNull();
    expect(upsertedBoundary).toBeNull();
  });
});
