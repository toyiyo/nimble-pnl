import { describe, expect, it } from 'vitest';

import type { CapabilityCheckClient } from '../../../supabase/functions/_shared/tools-registry';

// supabase-js rpc() returns a PostgREST builder. The builder has then() and
// no catch(). The type must say so, or a .catch() call compiles and then
// throws a TypeError at run time (the AI tool outage of 2026-08-18).
type RpcReturn = ReturnType<CapabilityCheckClient['rpc']>;

declare const rpcReturn: RpcReturn;

describe('CapabilityCheckClient.rpc return type', () => {
  it('does not allow .catch() on the builder', () => {
    const useCatch = () =>
      // @ts-expect-error a PostgREST builder has no catch() method.
      rpcReturn.catch(() => null);
    expect(typeof useCatch).toBe('function');
  });

  it('allows await (then() exists)', () => {
    const useAwait = async () => (await rpcReturn).data;
    expect(typeof useAwait).toBe('function');
  });
});
