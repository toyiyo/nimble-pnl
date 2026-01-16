import { describe, it, expect } from 'vitest';

/**
 * Test suite for extractDateFromFilename function
 * This is a validation test for the Edge Function implementation
 * The actual implementation is in supabase/functions/process-expense-invoice/index.ts
 */

// Mirror the implementation for testing purposes
function extractDateFromFilename(filename: string | null): string | null {
  if (!filename) return null;
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, '');

  const isValidParts = (y: number, m: number, d: number): boolean => {
    const date = new Date(y, m, d);
    return date.getFullYear() === y && date.getMonth() === m && date.getDate() === d;
  };

  const isoPattern = /(\d{4})[-_./](\d{1,2})[-_./](\d{1,2})/;
  const isoMatch = nameWithoutExt.match(isoPattern);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1;
    const d = parseInt(day, 10);
    if (isValidParts(y, m, d)) {
      return new Date(y, m, d).toISOString().split('T')[0];
    }
  }

  const usPattern = /(\d{1,2})[-_./](\d{1,2})[-_./](\d{4})/;
  const usMatch = nameWithoutExt.match(usPattern);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1;
    const d = parseInt(day, 10);
    if (isValidParts(y, m, d)) {
      return new Date(y, m, d).toISOString().split('T')[0];
    }
  }

  return null;
}

describe('extractDateFromFilename - Date Rollover Protection', () => {
  describe('ISO pattern (YYYY-MM-DD)', () => {
    it('should extract valid date', () => {
      expect(extractDateFromFilename('invoice_2024-03-15.pdf')).toBe('2024-03-15');
    });

    it('should extract valid date with underscores', () => {
      expect(extractDateFromFilename('receipt_2024_03_15.jpg')).toBe('2024-03-15');
    });

    it('should extract valid date with slashes', () => {
      expect(extractDateFromFilename('invoice_2024/03/15.pdf')).toBe('2024-03-15');
    });

    it('CRITICAL: should reject Feb 30 (non-existent date)', () => {
      // JS Date would normalize 2024-02-30 to 2024-03-01
      // Our validation should catch this
      expect(extractDateFromFilename('invoice_2024-02-30.pdf')).toBe(null);
    });

    it('CRITICAL: should reject Feb 29 in non-leap year', () => {
      expect(extractDateFromFilename('invoice_2023-02-29.pdf')).toBe(null);
    });

    it('should accept Feb 29 in leap year', () => {
      expect(extractDateFromFilename('invoice_2024-02-29.pdf')).toBe('2024-02-29');
    });

    it('CRITICAL: should reject Apr 31 (month has only 30 days)', () => {
      expect(extractDateFromFilename('invoice_2024-04-31.pdf')).toBe(null);
    });

    it('CRITICAL: should reject month 13', () => {
      expect(extractDateFromFilename('invoice_2024-13-01.pdf')).toBe(null);
    });

    it('should accept valid end-of-month dates', () => {
      expect(extractDateFromFilename('invoice_2024-01-31.pdf')).toBe('2024-01-31');
      expect(extractDateFromFilename('invoice_2024-03-31.pdf')).toBe('2024-03-31');
      expect(extractDateFromFilename('invoice_2024-12-31.pdf')).toBe('2024-12-31');
    });
  });

  describe('US pattern (MM-DD-YYYY)', () => {
    it('should extract valid date', () => {
      expect(extractDateFromFilename('invoice_03-15-2024.pdf')).toBe('2024-03-15');
    });

    it('should extract valid date with underscores', () => {
      expect(extractDateFromFilename('receipt_03_15_2024.jpg')).toBe('2024-03-15');
    });

    it('CRITICAL: should reject Feb 30 (non-existent date)', () => {
      expect(extractDateFromFilename('invoice_02-30-2024.pdf')).toBe(null);
    });

    it('CRITICAL: should reject Apr 31', () => {
      expect(extractDateFromFilename('invoice_04-31-2024.pdf')).toBe(null);
    });

    it('should accept Feb 29 in leap year', () => {
      expect(extractDateFromFilename('invoice_02-29-2024.pdf')).toBe('2024-02-29');
    });

    it('CRITICAL: should reject month 13', () => {
      expect(extractDateFromFilename('invoice_13-01-2024.pdf')).toBe(null);
    });
  });

  describe('Edge cases', () => {
    it('should handle null filename', () => {
      expect(extractDateFromFilename(null)).toBe(null);
    });

    it('should handle empty string', () => {
      expect(extractDateFromFilename('')).toBe(null);
    });

    it('should handle filename without date', () => {
      expect(extractDateFromFilename('invoice.pdf')).toBe(null);
    });

    it('should handle filename with invalid date format', () => {
      expect(extractDateFromFilename('invoice_abc-def-ghij.pdf')).toBe(null);
    });

    it('should extract first valid date if multiple patterns present', () => {
      // ISO pattern appears first, should be matched
      const result = extractDateFromFilename('2024-03-15_03-20-2024.pdf');
      expect(result).toBe('2024-03-15');
    });
  });
});
