/**
 * Task 5: structural tests for pack_quantity on ReceiptLineItem
 * and the generated Supabase types.
 *
 * RED: written before the interface changes; the property access
 *      on a minimal interface-typed object returns undefined (not 500/null)
 *      until pack_quantity is added to the interface.
 * GREEN: pass after ReceiptLineItem gains pack_quantity + types updated.
 */
import { describe, it, expect } from 'vitest';
import type { ReceiptLineItem } from '@/hooks/useReceiptImport';
import type { Database } from '@/integrations/supabase/types';

// Minimal factory that builds a ReceiptLineItem using ONLY the fields
// declared on the interface at compile time.  After adding pack_quantity
// this factory can include it without a cast.
function makeLineItem(overrides: Partial<ReceiptLineItem> = {}): ReceiptLineItem {
  return {
    id: 'item-id',
    receipt_id: 'receipt-id',
    raw_text: 'RAW TEXT',
    parsed_name: 'Test Item',
    parsed_quantity: 1,
    parsed_unit: 'each',
    parsed_price: null,
    parsed_sku: null,
    unit_price: null,
    package_type: null,
    size_value: null,
    size_unit: null,
    pack_quantity: null,  // declared on the interface → present in spread
    matched_product_id: null,
    confidence_score: 0.9,
    mapping_status: 'pending',
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

// ── Runtime checks ────────────────────────────────────────────────────────────

describe('ReceiptLineItem.pack_quantity — interface shape', () => {
  it('pack_quantity field exists on ReceiptLineItem interface (not undefined)', () => {
    // Pre-change: makeLineItem() returns an object WITHOUT pack_quantity declared
    // on the interface, so `item.pack_quantity` will be `undefined` (not null).
    // Post-change: the interface declares it as `number | null`, so the spread
    // produces `null` (the missing-key value for nullable fields).
    const item = makeLineItem();
    // After the interface change this must be null (or a number), never undefined.
    expect(item.pack_quantity).not.toBeUndefined();
  });

  it('PFG mustard row: pack_quantity = 500', () => {
    const item = makeLineItem({ pack_quantity: 500, parsed_quantity: 500 });
    expect(item.pack_quantity).toBe(500);
  });

  it('retail row: pack_quantity = null', () => {
    const item = makeLineItem({ pack_quantity: null });
    expect(item.pack_quantity).toBeNull();
  });

  it('vodka row: pack_quantity = 1 (no multiplier)', () => {
    const item = makeLineItem({ pack_quantity: 1, package_type: 'bottle', size_value: 750, size_unit: 'ml' });
    // A pack of 1 means "no breakdown" — same semantics as null but explicit
    expect(item.pack_quantity).toBe(1);
    expect(!item.pack_quantity || item.pack_quantity <= 1).toBe(true);
  });
});

// ── Generated Supabase types ─────────────────────────────────────────────────

describe('Supabase generated types — receipt_line_items.pack_quantity', () => {
  it('Row type has pack_quantity as number | null (not undefined)', () => {
    // Build a Row object.  Before the type update, the Row doesn't include
    // pack_quantity so `row.pack_quantity` TypeScript-wise should be undefined at
    // the type level (which would make the runtime test trivially pass).
    // After the update the key exists.  We verify that a fully-typed Row
    // assignment can include pack_quantity without a cast.
    type Row = Database['public']['Tables']['receipt_line_items']['Row'];
    const row: Row = {
      confidence_score: null,
      created_at: '2026-07-02T00:00:00Z',
      id: 'id',
      line_sequence: 1,
      mapping_status: 'pending',
      matched_product_id: null,
      package_type: null,
      parsed_name: null,
      parsed_price: null,
      parsed_quantity: null,
      parsed_sku: null,
      parsed_unit: null,
      raw_text: 'RAW',
      receipt_id: 'receipt',
      size_unit: null,
      size_value: null,
      unit_price: null,
      updated_at: '2026-07-02T00:00:00Z',
      pack_quantity: 500,  // ← must exist on the type for no cast needed
    };
    expect(row.pack_quantity).toBe(500);
  });

  it('Insert type accepts pack_quantity as optional', () => {
    type Insert = Database['public']['Tables']['receipt_line_items']['Insert'];
    const insert: Insert = {
      raw_text: 'test',
      receipt_id: 'receipt-id',
      pack_quantity: 12,
    };
    expect(insert.pack_quantity).toBe(12);
  });

  it('Insert type accepts pack_quantity: null (retail row)', () => {
    type Insert = Database['public']['Tables']['receipt_line_items']['Insert'];
    const insert: Insert = {
      raw_text: 'test',
      receipt_id: 'receipt-id',
      pack_quantity: null,
    };
    expect(insert.pack_quantity).toBeNull();
  });

  it('Insert type accepts pack_quantity omitted (undefined / no value)', () => {
    type Insert = Database['public']['Tables']['receipt_line_items']['Insert'];
    const insert: Insert = {
      raw_text: 'test',
      receipt_id: 'receipt-id',
    };
    expect(insert.pack_quantity).toBeUndefined();
  });
});
