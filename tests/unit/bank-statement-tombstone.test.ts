import { describe, it, expect } from 'vitest';
import { computeTransactionFingerprint } from '@/lib/bankTransactionTombstone';

describe('computeTransactionFingerprint', () => {
  it('produces same fingerprint for identical inputs', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'RESTAURANT DEPOT #123');
    const b = computeTransactionFingerprint('2026-01-15', 42.50, 'RESTAURANT DEPOT #123');
    expect(a).toBe(b);
  });

  it('normalizes description (case + punctuation)', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'Restaurant Depot #123!');
    const b = computeTransactionFingerprint('2026-01-15', 42.50, 'restaurant depot 123');
    expect(a).toBe(b);
  });

  it('produces different fingerprints for different amounts', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'STORE');
    const b = computeTransactionFingerprint('2026-01-15', 42.51, 'STORE');
    expect(a).not.toBe(b);
  });

  it('produces different fingerprints for different dates', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'STORE');
    const b = computeTransactionFingerprint('2026-01-16', 42.50, 'STORE');
    expect(a).not.toBe(b);
  });

  it('handles debit vs credit direction', () => {
    const a = computeTransactionFingerprint('2026-01-15', 42.50, 'STORE');
    const b = computeTransactionFingerprint('2026-01-15', -42.50, 'STORE');
    expect(a).not.toBe(b);
  });

  it('handles empty description gracefully', () => {
    const a = computeTransactionFingerprint('2026-01-15', 10.00, '');
    const b = computeTransactionFingerprint('2026-01-15', 10.00, '');
    expect(a).toBe(b);
    expect(a).toContain('2026-01-15');
  });

  it('handles null-ish description gracefully', () => {
    // The function accepts string, but upstream may pass empty string for nulls
    const a = computeTransactionFingerprint('2026-01-15', 10.00, '');
    expect(a).toBe('2026-01-15|1000|credit|');
  });

  it('strips leading/trailing whitespace from description', () => {
    const a = computeTransactionFingerprint('2026-01-15', 5.00, '  STORE  ');
    const b = computeTransactionFingerprint('2026-01-15', 5.00, 'STORE');
    expect(a).toBe(b);
  });

  it('correctly converts fractional amounts to cents', () => {
    const fp = computeTransactionFingerprint('2026-01-15', 0.01, 'TEST');
    expect(fp).toContain('|1|');
  });

  it('treats zero as credit direction', () => {
    const fp = computeTransactionFingerprint('2026-01-15', 0, 'TEST');
    expect(fp).toContain('|credit|');
  });
});
