import { describe, it, expect } from 'vitest';
import { normalizeDate, normalizePdfInput } from '../../supabase/functions/_shared/expenseInvoiceUtils';

describe('expenseInvoiceUtils', () => {
  describe('normalizeDate', () => {
    it('returns null for empty date strings', () => {
      expect(normalizeDate(undefined)).toBeNull();
      expect(normalizeDate('')).toBeNull();
    });

    it('rejects future dates unless allowFuture is true', () => {
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      expect(normalizeDate(futureDate)).toBeNull();
      expect(normalizeDate(futureDate, true)).not.toBeNull();
      expect(normalizeDate(pastDate)).not.toBeNull();
    });
  });

  describe('normalizePdfInput', () => {
    it('returns data URL unchanged when already prefixed', () => {
      const dataUrl = 'data:application/pdf;base64,abc123';
      const result = normalizePdfInput(dataUrl);
      expect(result).toEqual({ value: dataUrl, isRemote: false });
    });

    it('prefixes raw base64 data with the PDF data URL prefix', () => {
      const base64 = 'abc123';
      const result = normalizePdfInput(base64);
      expect(result).toEqual({ value: 'data:application/pdf;base64,abc123', isRemote: false });
    });

    it('returns remote URLs as-is and marks them remote', () => {
      const url = 'https://example.com/invoice.pdf';
      const result = normalizePdfInput(url);
      expect(result).toEqual({ value: url, isRemote: true });
    });
  });
});
