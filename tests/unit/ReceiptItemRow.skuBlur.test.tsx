/**
 * Task 4 (Phase 4, task 4/4): Commit SKU field on blur, not per keystroke (Change 3)
 *
 * RED: Written before the ReceiptItemRow change — the SKU input currently calls
 *   onSkuChange on every keystroke (onChange), which races per-keystroke writes
 *   and can re-tier a matched row out from under the user mid-type.
 * GREEN: Pass once the SKU input commits via onBlur instead, while remaining
 *   uncontrolled (defaultValue, not value).
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReceiptItemRow } from '@/components/receipt/ReceiptItemRow';
import type { ReceiptLineItem } from '@/hooks/useReceiptImport';

// ── Minimal stubs for heavy deps ─────────────────────────────────────────────
vi.mock('@/components/SearchableProductSelector', () => ({
  SearchableProductSelector: () => <div data-testid="product-selector" />,
}));
vi.mock('@/components/GroupedUnitSelector', () => ({
  GroupedUnitSelector: ({ value, placeholder }: { value?: string; placeholder?: string }) => (
    <select aria-label="Unit" defaultValue={value || ''}>
      <option value="">{placeholder ?? ''}</option>
    </select>
  ),
}));

function makeItem(overrides: Partial<ReceiptLineItem> = {}): ReceiptLineItem {
  return {
    id: 'item-1',
    receipt_id: 'receipt-1',
    raw_text: 'GULDENS MUSTARD PACKET',
    parsed_name: 'Guldens Mustard Packet',
    parsed_quantity: 500,
    parsed_unit: 'each',
    parsed_price: 29.96,
    parsed_sku: null,
    unit_price: 0.0599,
    package_type: 'packet',
    size_value: 0.32,
    size_unit: 'oz',
    pack_quantity: 500,
    matched_product_id: null,
    confidence_score: 0.9,
    mapping_status: 'pending',
    created_at: '2026-07-02T00:00:00Z',
    updated_at: '2026-07-02T00:00:00Z',
    ...overrides,
  };
}

function renderRow(onSkuChange: (itemId: string, sku: string) => void, itemOverrides: Partial<ReceiptLineItem> = {}) {
  const item = makeItem(itemOverrides);
  const defaultProps = {
    index: 0,
    tier: 'quick-review' as const,
    linkedCount: 1,
    products: [],
    isImported: false,
    onMappingChange: vi.fn(),
    onQuantityChange: vi.fn(),
    onPriceChange: vi.fn(),
    onNameChange: vi.fn(),
    onPackageTypeChange: vi.fn(),
    onSizeValueChange: vi.fn(),
    onSizeUnitChange: vi.fn(),
    onSkuChange,
    onApplySuggestion: vi.fn(),
    onQuickFill: vi.fn(),
    categoryQuickFills: [],
  };
  return render(<ReceiptItemRow item={item} {...defaultProps} />);
}

describe('ReceiptItemRow — SKU/Barcode input commits on blur', () => {
  it('does NOT call onSkuChange while typing (per-keystroke)', () => {
    const onSkuChange = vi.fn();
    renderRow(onSkuChange);
    const skuInput = screen.getByLabelText(/SKU \/ Barcode/i);
    fireEvent.change(skuInput, { target: { value: '1' } });
    fireEvent.change(skuInput, { target: { value: '12' } });
    fireEvent.change(skuInput, { target: { value: '123' } });
    expect(onSkuChange).not.toHaveBeenCalled();
  });

  it('calls onSkuChange exactly once, with the final value, on blur', () => {
    const onSkuChange = vi.fn();
    renderRow(onSkuChange);
    const skuInput = screen.getByLabelText(/SKU \/ Barcode/i);
    fireEvent.change(skuInput, { target: { value: '1' } });
    fireEvent.change(skuInput, { target: { value: '12' } });
    fireEvent.change(skuInput, { target: { value: '123456789' } });
    fireEvent.blur(skuInput);
    expect(onSkuChange).toHaveBeenCalledTimes(1);
    expect(onSkuChange).toHaveBeenCalledWith('item-1', '123456789');
  });

  it('does not call onSkuChange again on a second blur with no intervening edits', () => {
    const onSkuChange = vi.fn();
    renderRow(onSkuChange);
    const skuInput = screen.getByLabelText(/SKU \/ Barcode/i);
    fireEvent.change(skuInput, { target: { value: '999' } });
    fireEvent.blur(skuInput);
    fireEvent.blur(skuInput);
    expect(onSkuChange).toHaveBeenCalledTimes(2);
    expect(onSkuChange).toHaveBeenNthCalledWith(1, 'item-1', '999');
    expect(onSkuChange).toHaveBeenNthCalledWith(2, 'item-1', '999');
  });

  it('stays uncontrolled: uses defaultValue seeded from parsed_sku, not a controlled value prop', () => {
    const onSkuChange = vi.fn();
    renderRow(onSkuChange, { parsed_sku: 'ABC-123' });
    const skuInput = screen.getByLabelText(/SKU \/ Barcode/i) as HTMLInputElement;
    expect(skuInput.value).toBe('ABC-123');
    // Typing should update the DOM value locally without needing a re-render from a `value` prop.
    fireEvent.change(skuInput, { target: { value: 'ABC-124' } });
    expect(skuInput.value).toBe('ABC-124');
  });
});
