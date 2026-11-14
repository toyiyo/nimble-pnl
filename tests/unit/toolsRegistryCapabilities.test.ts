/**
 * Capability helpers in tools-registry: hasPosSalesCapability and
 * hasEditSchedulingCapability. Both fail closed and log an RPC failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  hasPosSalesCapability,
  hasEditSchedulingCapability,
} from '../../supabase/functions/_shared/tools-registry';

const RID = 'rest-1';

const cases = [
  { name: 'hasPosSalesCapability', fn: hasPosSalesCapability, capability: 'view:pos_sales' },
  { name: 'hasEditSchedulingCapability', fn: hasEditSchedulingCapability, capability: 'edit:scheduling' },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(cases)('$name', ({ fn, capability }) => {
  it('returns true when the RPC returns true', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(await fn(RID, { rpc })).toBe(true);
  });

  it('returns false when the RPC returns false', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    expect(await fn(RID, { rpc })).toBe(false);
  });

  it('returns false and logs once when the RPC returns an error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await fn(RID, { rpc })).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns false when the RPC throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn().mockRejectedValue(new Error('network'));
    expect(await fn(RID, { rpc })).toBe(false);
  });

  it('calls user_has_capability with the exact capability string', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await fn(RID, { rpc });
    expect(rpc).toHaveBeenCalledWith('user_has_capability', {
      p_restaurant_id: RID,
      p_capability: capability,
    });
  });
});
