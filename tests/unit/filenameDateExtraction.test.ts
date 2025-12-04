import { describe, it, expect } from 'vitest';
import { extractDateFromFilename } from '@/utils/filenameDateExtraction';

describe('Filename Date Extraction', () => {
  describe('ISO date format (YYYY-MM-DD)', () => {
    it('extracts date from YYYY-MM-DD format', () => {
      const result = extractDateFromFilename('statement-2024-01-15.pdf');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(0); // January = 0
      expect(result?.date.getDate()).toBe(15);
      expect(result?.confidence).toBe('high');
    });

    it('extracts date from YYYY_MM_DD format', () => {
      const result = extractDateFromFilename('invoice_2024_03_20.csv');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(2); // March = 2
      expect(result?.date.getDate()).toBe(20);
    });
  });

  describe('US date format (MM-DD-YYYY)', () => {
    it('extracts date from MM-DD-YYYY format', () => {
      const result = extractDateFromFilename('report-12-25-2024.pdf');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(11); // December = 11
      expect(result?.date.getDate()).toBe(25);
      expect(result?.confidence).toBe('high');
    });
  });

  describe('Compact format (YYYYMMDD)', () => {
    it('extracts date from YYYYMMDD format', () => {
      const result = extractDateFromFilename('backup20240615.zip');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(5); // June = 5
      expect(result?.date.getDate()).toBe(15);
      expect(result?.confidence).toBe('medium');
    });
  });

  describe('Month name format', () => {
    it('extracts date from Month DD, YYYY format', () => {
      const result = extractDateFromFilename('sales-jan-15-2024.xlsx');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(0); // January = 0
      expect(result?.date.getDate()).toBe(15);
    });
  });

  describe('No date found', () => {
    it('returns null for files without dates', () => {
      const result = extractDateFromFilename('my-document.pdf');
      expect(result).toBeNull();
    });

    it('returns null for empty filename', () => {
      const result = extractDateFromFilename('');
      expect(result).toBeNull();
    });
  });

  describe('Real-world bank statement filenames', () => {
    it('handles Chase statement format', () => {
      const result = extractDateFromFilename('Chase_Statement_2024-11-15.pdf');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(10); // November = 10
    });

    it('handles Bank of America format', () => {
      const result = extractDateFromFilename('eStatement_2024-12-01.pdf');
      expect(result).not.toBeNull();
      expect(result?.date.getFullYear()).toBe(2024);
      expect(result?.date.getMonth()).toBe(11); // December = 11
    });
  });
});
