import { describe, it, expect } from 'vitest';
import { getAreaMismatch } from '@/lib/shiftTradeArea';

describe('getAreaMismatch', () => {
  // ── mismatch cases (should return an AreaMismatch object) ────────────────

  it('returns mismatch object when both areas are known and differ', () => {
    const result = getAreaMismatch('Bar', 'BOH/Dish');
    expect(result).toEqual({ offeredArea: 'Bar', claimerArea: 'BOH/Dish' });
  });

  it('trims surrounding whitespace before comparing and in the returned value', () => {
    const result = getAreaMismatch('  Bar  ', '  BOH/Dish  ');
    expect(result).toEqual({ offeredArea: 'Bar', claimerArea: 'BOH/Dish' });
  });

  // ── same-area cases (should return null) ─────────────────────────────────

  it('returns null when both areas are identical', () => {
    const result = getAreaMismatch('Bar', 'Bar');
    expect(result).toBeNull();
  });

  it('returns null when areas are case-insensitively identical (mixed case)', () => {
    const result = getAreaMismatch('Bar', 'bar');
    expect(result).toBeNull();
  });

  it('returns null when areas are case-insensitively identical (uppercase vs lowercase)', () => {
    const result = getAreaMismatch('FOH', 'foh');
    expect(result).toBeNull();
  });

  // ── unknown-area cases (should return null) ───────────────────────────────

  it('returns null when offered area is null', () => {
    const result = getAreaMismatch(null, 'Bar');
    expect(result).toBeNull();
  });

  it('returns null when claimer area is null', () => {
    const result = getAreaMismatch('Bar', null);
    expect(result).toBeNull();
  });

  it('returns null when offered area is undefined', () => {
    const result = getAreaMismatch(undefined, 'Bar');
    expect(result).toBeNull();
  });

  it('returns null when claimer area is undefined', () => {
    const result = getAreaMismatch('Bar', undefined);
    expect(result).toBeNull();
  });

  it('returns null when offered area is empty string', () => {
    const result = getAreaMismatch('', 'Bar');
    expect(result).toBeNull();
  });

  it('returns null when claimer area is empty string', () => {
    const result = getAreaMismatch('Bar', '');
    expect(result).toBeNull();
  });

  it('returns null when offered area is whitespace-only', () => {
    const result = getAreaMismatch('   ', 'Bar');
    expect(result).toBeNull();
  });

  it('returns null when claimer area is whitespace-only', () => {
    const result = getAreaMismatch('Bar', '   ');
    expect(result).toBeNull();
  });

  it('returns null when both areas are null', () => {
    const result = getAreaMismatch(null, null);
    expect(result).toBeNull();
  });

  it('returns null when both areas are undefined', () => {
    const result = getAreaMismatch(undefined, undefined);
    expect(result).toBeNull();
  });

  it('returns null when both areas are empty strings', () => {
    const result = getAreaMismatch('', '');
    expect(result).toBeNull();
  });

  // ── preserves original casing in returned value ───────────────────────────

  it('preserves original casing of offeredArea in the returned object', () => {
    const result = getAreaMismatch('FOH', 'BOH');
    expect(result?.offeredArea).toBe('FOH');
  });

  it('preserves original casing of claimerArea in the returned object', () => {
    const result = getAreaMismatch('FOH', 'BOH');
    expect(result?.claimerArea).toBe('BOH');
  });
});
