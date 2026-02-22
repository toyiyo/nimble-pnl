import { describe, it, expect } from 'vitest';
import {
  buildReceiptReferencePattern,
  matchesReceiptReference,
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
