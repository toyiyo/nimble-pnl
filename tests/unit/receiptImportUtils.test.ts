import { describe, it, expect } from 'vitest';
import { parsePackSizeToken, computeImportedQuantity } from '@/utils/receiptImportUtils';

describe('computeImportedQuantity', () => {
  it('multiplies cases by pack (butter: 2 × 4 = 8)', () => {
    expect(computeImportedQuantity({ casesOrdered: 2, unitsPerPack: 4 })).toBe(8);
  });
  it('mustard 1 × 500 = 500', () => {
    expect(computeImportedQuantity({ casesOrdered: 1, unitsPerPack: 500 })).toBe(500);
  });
  it('defaults null/zero inputs to 1 (vodka: 1 × 1 = 1)', () => {
    expect(computeImportedQuantity({ casesOrdered: null, unitsPerPack: null })).toBe(1);
    expect(computeImportedQuantity({ casesOrdered: 0, unitsPerPack: 0 })).toBe(1);
  });
});

describe('parsePackSizeToken (Sygma pack/size tokens)', () => {
  it('parses "8/32 OZ" → pack 8, size 32 oz', () => {
    expect(parsePackSizeToken('8/32 OZ')).toEqual({ unitsPerPack: 8, sizeValue: 32, sizeUnit: 'oz' });
  });
  it('parses "1/20 LB" → pack 1, size 20 lb', () => {
    expect(parsePackSizeToken('1/20 LB')).toEqual({ unitsPerPack: 1, sizeValue: 20, sizeUnit: 'lb' });
  });
  it('parses decimal size "2/2.5GAL" → pack 2, size 2.5 gal (parseFloat, not parseInt)', () => {
    expect(parsePackSizeToken('2/2.5GAL')).toEqual({ unitsPerPack: 2, sizeValue: 2.5, sizeUnit: 'gal' });
  });
  it('treats a slash-less token "20 LB" as pack 1', () => {
    expect(parsePackSizeToken('20 LB')).toEqual({ unitsPerPack: 1, sizeValue: 20, sizeUnit: 'lb' });
  });
  it('returns null for an unparseable token', () => {
    expect(parsePackSizeToken('')).toBeNull();
  });
});
