/**
 * Compile-time check: the typed browser client fits the structural client
 * type that the shared labor engine takes (`supabase/functions/_shared/labor/`).
 *
 * The shared engine must not import `@supabase/supabase-js` types, because
 * Deno resolves that package in a different way. So it takes a small
 * structural client type.
 *
 * Result of plan Task 1 (single labor engine): a structural type that
 * describes the full query chain (`from().select().eq()...range()`) fails with
 * TS2589 "Type instantiation is excessively deep and possibly infinite". The
 * typed client fits only a type whose `from()` returns `unknown`. The engine
 * casts that result to its own chain type in one type-only helper, as
 * `asPagedRows` does.
 *
 * These are type assertions, so `npm run typecheck:types` is the real test.
 * Vitest strips the types and runs only the runtime check below.
 */
import { describe, it, expect } from 'vitest';
import type { supabase } from '@/integrations/supabase/client';
import type { LaborQueryClient } from '../../../supabase/functions/_shared/labor/types';
import type { fetchTipSplitRows } from '../../../supabase/functions/_shared/labor/tipsFetch';

type BrowserClient = typeof supabase;

function takesLaborClient(client: LaborQueryClient): LaborQueryClient {
  return client;
}

describe('LaborQueryClient', () => {
  it('accepts the typed browser client at compile time', () => {
    const accept = (client: BrowserClient) => takesLaborClient(client);
    const acceptTips = (client: BrowserClient, fetchTips: typeof fetchTipSplitRows) =>
      fetchTips(client, 'rest-1', '2026-08-01', '2026-08-31');
    // A value without `from()` must fail. This @ts-expect-error fails the
    // type check if the structural type ever accepts anything.
    // @ts-expect-error -- no `from` method
    const reject = () => takesLaborClient({});
    expect(typeof accept).toBe('function');
    expect(typeof acceptTips).toBe('function');
    expect(typeof reject).toBe('function');
  });
});
