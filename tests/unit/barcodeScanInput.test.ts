import { describe, it, expect } from 'vitest';
import {
  parseScannedBarcode,
  SCAN_FORMAT,
  SCAN_IDLE_MS,
  MIN_TIMEOUT_BARCODE_LENGTH,
} from '@/lib/barcodeScanInput';

describe('parseScannedBarcode', () => {
  it('strips the @@ prefix and returns the code', () => {
    expect(parseScannedBarcode('@@012345678905', 1)).toBe('012345678905');
  });

  it('strips the ]Q prefix', () => {
    expect(parseScannedBarcode(']Q012345678905', 1)).toBe('012345678905');
  });

  it('trims surrounding whitespace', () => {
    expect(parseScannedBarcode('  012345  ', 1)).toBe('012345');
  });

  it('returns null when shorter than minLength', () => {
    expect(parseScannedBarcode('ab', 3)).toBeNull();
  });

  it('returns the code at exactly minLength', () => {
    expect(parseScannedBarcode('abc', 3)).toBe('abc');
  });

  it('returns null for empty / whitespace-only input', () => {
    expect(parseScannedBarcode('   ', 1)).toBeNull();
  });

  it('exposes stable constants', () => {
    expect(SCAN_FORMAT).toBe('KeyboardHID');
    expect(SCAN_IDLE_MS).toBeGreaterThan(0);
    expect(MIN_TIMEOUT_BARCODE_LENGTH).toBeGreaterThanOrEqual(2);
  });
});
