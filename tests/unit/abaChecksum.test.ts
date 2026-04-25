import { describe, it, expect } from 'vitest';
import { isValidAbaRouting } from '@/lib/abaChecksum';

describe('isValidAbaRouting', () => {
  it('accepts a known-good Chase Texas routing number', () => {
    expect(isValidAbaRouting('111000614')).toBe(true);
  });

  it('accepts a second known-good routing (Wells Fargo NY)', () => {
    expect(isValidAbaRouting('026009593')).toBe(true);
  });

  it('rejects a 9-digit number with a bad checksum', () => {
    expect(isValidAbaRouting('111000615')).toBe(false);
  });

  it('rejects shorter than 9 digits', () => {
    expect(isValidAbaRouting('12345678')).toBe(false);
  });

  it('rejects longer than 9 digits', () => {
    expect(isValidAbaRouting('1110006141')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isValidAbaRouting('11100061a')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidAbaRouting('')).toBe(false);
  });

  it('rejects all zeros (passes checksum but invalid routing)', () => {
    expect(isValidAbaRouting('000000000')).toBe(false);
  });
});
