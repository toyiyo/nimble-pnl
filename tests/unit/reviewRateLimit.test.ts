import { describe, it, expect } from 'vitest';
import {
  hashIp,
  isOverLimit,
  REVIEW_RATE_LIMIT_PER_HOUR,
  REVIEW_RATE_WINDOW_MS,
} from '../../supabase/functions/_shared/reviewRateLimit';

describe('reviewRateLimit', () => {
  it('allows 120 requests per hour', () => {
    expect(REVIEW_RATE_LIMIT_PER_HOUR).toBe(120);
    expect(REVIEW_RATE_WINDOW_MS).toBe(3_600_000);
  });

  it('is over the limit only once the window is full', () => {
    expect(isOverLimit(0)).toBe(false);
    expect(isOverLimit(119)).toBe(false);
    expect(isOverLimit(120)).toBe(true);
    expect(isOverLimit(1000)).toBe(true);
  });

  it('hashes an IP to a stable 64-character hex digest', async () => {
    const a = await hashIp('203.0.113.7', 'pepper');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIp('203.0.113.7', 'pepper')).toBe(a);
  });

  it('produces different digests for different IPs', async () => {
    expect(await hashIp('203.0.113.7', 'pepper')).not.toBe(
      await hashIp('203.0.113.8', 'pepper')
    );
  });

  it('produces different digests under different peppers', async () => {
    expect(await hashIp('203.0.113.7', 'pepper-a')).not.toBe(
      await hashIp('203.0.113.7', 'pepper-b')
    );
  });
});
