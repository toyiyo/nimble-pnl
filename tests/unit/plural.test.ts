import { describe, it, expect } from 'vitest';

import { plural } from '../../supabase/functions/_shared/plural';
import { plural as reExported } from '@/lib/claimableTrades';

describe('plural', () => {
  it('adds no "s" for one and adds "s" for other counts', () => {
    expect(plural(1, 'hour')).toBe('1 hour');
    expect(plural(0, 'shift')).toBe('0 shifts');
    expect(plural(5, 'minute')).toBe('5 minutes');
  });

  it('is the same function in the app and in the edge functions', () => {
    expect(reExported).toBe(plural);
  });
});
