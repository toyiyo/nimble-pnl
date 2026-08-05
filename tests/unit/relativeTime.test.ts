import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '@/lib/reviews/relativeTime';

const NOW = Date.parse('2026-08-04T12:00:00Z');

function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(formatRelativeTime(ago(30_000), NOW)).toBe('just now');
  });

  it('reads minutes under an hour', () => {
    expect(formatRelativeTime(ago(45 * 60_000), NOW)).toBe('45m ago');
  });

  it('reads hours under a day', () => {
    expect(formatRelativeTime(ago(5 * 3_600_000), NOW)).toBe('5h ago');
  });

  it('reads days beyond that', () => {
    expect(formatRelativeTime(ago(3 * 86_400_000), NOW)).toBe('3d ago');
  });

  it('clamps a future timestamp to "just now" rather than printing a negative', () => {
    expect(formatRelativeTime(new Date(NOW + 60_000).toISOString(), NOW)).toBe('just now');
  });
});
