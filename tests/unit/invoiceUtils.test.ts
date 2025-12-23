/**
 * Tests for src/lib/invoiceUtils.ts
 *
 * These tests cover invoice utility functions including processing fee calculations.
 */

import { describe, it, expect } from 'vitest';
import { computeProcessingFeeCents } from '@/lib/invoiceUtils';

describe('Invoice Utilities', () => {
  describe('computeProcessingFeeCents', () => {
    it('calculates processing fee for positive amounts', () => {
      // Standard calculation: (amount + 30) / (1 - 0.029) - amount
      // For $10.00: (1000 + 30) / 0.971 - 1000 = 1030 / 0.971 - 1000 ≈ 1060.76 - 1000 = 60.76
      expect(computeProcessingFeeCents(1000)).toBe(61); // Rounded result

      // For $20.00: (2000 + 30) / 0.971 - 2000 ≈ 2030 / 0.971 - 2000 ≈ 2090.63 - 2000 = 90.63
      expect(computeProcessingFeeCents(2000)).toBe(91);

      // For $1.00: (100 + 30) / 0.971 - 100 ≈ 130 / 0.971 - 100 ≈ 133.88 - 100 = 33.88
      expect(computeProcessingFeeCents(100)).toBe(34);
    });

    it('returns 0 for zero or negative amounts', () => {
      expect(computeProcessingFeeCents(0)).toBe(0);
      expect(computeProcessingFeeCents(-100)).toBe(0);
      expect(computeProcessingFeeCents(-1)).toBe(0);
    });

    it('handles custom rates and fixed fees', () => {
      // Custom rate: 3%, fixed fee: 50 cents
      expect(computeProcessingFeeCents(1000, 0.03, 50)).toBe(82);

      // Higher rate: 5%, no fixed fee
      expect(computeProcessingFeeCents(1000, 0.05, 0)).toBe(53);

      // Lower rate: 1%, higher fixed fee
      expect(computeProcessingFeeCents(1000, 0.01, 100)).toBe(111);
    });

    it('rounds results appropriately', () => {
      // Test cases that result in fractional cents
      expect(computeProcessingFeeCents(1)).toBe(31); // Should round up/down appropriately
      expect(computeProcessingFeeCents(999)).toBe(61);
    });

    it('ensures fee is never negative', () => {
      // Even with very low amounts, fee should be >= 0
      expect(computeProcessingFeeCents(1)).toBeGreaterThanOrEqual(0);
      expect(computeProcessingFeeCents(10)).toBeGreaterThanOrEqual(0);
    });

    it('handles edge cases with very small amounts', () => {
      expect(computeProcessingFeeCents(1)).toBe(31);
      expect(computeProcessingFeeCents(29)).toBe(32); // Amount + fixed fee = 59, which is close to the fixed fee
      expect(computeProcessingFeeCents(30)).toBe(32);
    });
  });
});