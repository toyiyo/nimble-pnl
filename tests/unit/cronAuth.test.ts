import { describe, it, expect } from 'vitest';
import { isServiceRoleBearer } from '../../supabase/functions/_shared/cronAuth';

const KEY = 'service-role-key-123';

describe('isServiceRoleBearer', () => {
  it('accepts "Bearer <service role key>"', () => {
    expect(isServiceRoleBearer(`Bearer ${KEY}`, KEY)).toBe(true);
  });

  it('refuses a missing header', () => {
    expect(isServiceRoleBearer(null, KEY)).toBe(false);
    expect(isServiceRoleBearer('', KEY)).toBe(false);
  });

  it('refuses a different key of the same length', () => {
    expect(isServiceRoleBearer(`Bearer ${KEY.slice(0, -1)}X`, KEY)).toBe(false);
  });

  it('refuses a different length', () => {
    expect(isServiceRoleBearer(`Bearer ${KEY}x`, KEY)).toBe(false);
    expect(isServiceRoleBearer(KEY, KEY)).toBe(false);
  });

  it('refuses every header when the key is empty', () => {
    expect(isServiceRoleBearer('Bearer ', '')).toBe(false);
  });
});
