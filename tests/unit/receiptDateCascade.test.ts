import { describe, it, expect } from 'vitest';
import {
  buildReceiptReferencePattern,
  matchesReceiptReference,
  calculateUnitPrice,
} from '@/utils/receiptImportUtils';

/**
 * Tests for date cascade reference_id matching logic.
 *
 * When a user changes the purchase date on an already-imported receipt,
 * we need to find all inventory_transactions linked to that receipt
 * via the reference_id pattern: receipt_{receiptId}_{itemId}
 */

describe('Receipt Date Cascade - Reference ID Matching', () => {
  const receiptId = 'abc-123-def';

  it('should build correct LIKE pattern for receipt reference', () => {
    const pattern = buildReceiptReferencePattern(receiptId);
    expect(pattern).toBe('receipt_abc-123-def_%');
  });

  it('should match reference_ids belonging to the receipt', () => {
    expect(matchesReceiptReference('receipt_abc-123-def_item1', receiptId)).toBe(true);
    expect(matchesReceiptReference('receipt_abc-123-def_item2', receiptId)).toBe(true);
  });

  it('should NOT match reference_ids from other receipts', () => {
    expect(matchesReceiptReference('receipt_xyz-789_item1', receiptId)).toBe(false);
  });

  it('should NOT match non-receipt reference_ids', () => {
    expect(matchesReceiptReference('manual_adjustment_123', receiptId)).toBe(false);
    expect(matchesReceiptReference('', receiptId)).toBe(false);
  });
});

describe('calculateUnitPrice', () => {
  it('should return stored unit_price when available', () => {
    expect(calculateUnitPrice({ unit_price: 5.25, parsed_quantity: 2, parsed_price: 20.00 })).toBe(5.25);
  });

  it('should calculate from parsed_price / parsed_quantity when no unit_price', () => {
    expect(calculateUnitPrice({ unit_price: null, parsed_quantity: 4, parsed_price: 20.00 })).toBe(5.00);
  });

  it('should return parsed_price when quantity is zero', () => {
    expect(calculateUnitPrice({ unit_price: null, parsed_quantity: 0, parsed_price: 15.00 })).toBe(15.00);
  });

  it('should return parsed_price when quantity is null', () => {
    expect(calculateUnitPrice({ unit_price: null, parsed_quantity: null, parsed_price: 12.50 })).toBe(12.50);
  });

  it('should return 0 when all values are null', () => {
    expect(calculateUnitPrice({ unit_price: null, parsed_quantity: null, parsed_price: null })).toBe(0);
  });

  it('should return 0 when no properties provided', () => {
    expect(calculateUnitPrice({})).toBe(0);
  });

  it('should handle parsed_price of 0 with valid quantity', () => {
    expect(calculateUnitPrice({ unit_price: null, parsed_quantity: 5, parsed_price: 0 })).toBe(0);
  });
});
