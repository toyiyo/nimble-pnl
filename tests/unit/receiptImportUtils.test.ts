import { describe, it, expect } from 'vitest';
import { parsePackSizeToken, computeImportedQuantity, buildLineItemInsert } from '@/utils/receiptImportUtils';

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

describe('buildLineItemInsert (DB insert mapping for process-receipt)', () => {
  const baseItem = {
    rawText: 'GULDENS MUSTARD PACKET',
    parsedName: 'Guldens Mustard Packet',
    parsedQuantity: 500,
    parsedUnit: 'each',
    packageType: 'packet',
    sizeValue: 0.32,
    sizeUnit: 'oz',
    unitPrice: 0.0599,
    lineTotal: 29.96,
    confidenceScore: 0.9,
    casesOrdered: 1,
    unitsPerPack: 500,
  };

  it('maps unitsPerPack to pack_quantity (PFG mustard: 500 packets)', () => {
    const row = buildLineItemInsert('receipt-123', baseItem, 0);
    expect(row.pack_quantity).toBe(500);
  });

  it('maps pack_quantity to null when unitsPerPack is absent (retail row)', () => {
    const { casesOrdered: _c, unitsPerPack: _u, ...retailItem } = baseItem;
    const row = buildLineItemInsert('receipt-123', retailItem, 1);
    expect(row.pack_quantity).toBeNull();
  });

  it('maps all required fields correctly (receipt_id, raw_text, parsed_quantity, line_sequence)', () => {
    const row = buildLineItemInsert('receipt-abc', baseItem, 3);
    expect(row.receipt_id).toBe('receipt-abc');
    expect(row.raw_text).toBe('GULDENS MUSTARD PACKET');
    expect(row.parsed_quantity).toBe(500);
    expect(row.line_sequence).toBe(4); // index + 1
  });

  it('PFG butter: casesOrdered=2, unitsPerPack=4 → pack_quantity=4', () => {
    const butterItem = {
      ...baseItem,
      parsedName: 'Butter Clarified',
      casesOrdered: 2,
      unitsPerPack: 4,
      parsedQuantity: 8,
      unitPrice: 19.05,
      lineTotal: 152.40,
    };
    const row = buildLineItemInsert('receipt-xyz', butterItem, 0);
    expect(row.pack_quantity).toBe(4);
    expect(row.parsed_quantity).toBe(8);
  });
});
