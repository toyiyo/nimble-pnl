/**
 * Commit SKU field on blur, not per keystroke.
 *
 * The SKU input calls onSkuChange on blur, but only when the value actually
 * changed from the last-committed one. Since parsed_sku can arrive pre-filled
 * from a matched product's gtin/sku (auto-fill, display-only), a blur on an
 * untouched field — or a repeat blur with no intervening edit — must be a
 * no-op: it must not re-commit the auto-filled value as if the user had typed
 * it, and it must not re-tier a matched row out from under the user mid-type.
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
    expect(onSkuChange).toHaveBeenCalledTimes(1);
    expect(onSkuChange).toHaveBeenCalledWith('item-1', '999');
  });

  it('does not call onSkuChange on blur when the field was never edited (auto-filled value)', () => {
    // Regression: an auto-filled parsed_sku (from the matched product's gtin/sku) must not be
    // re-committed just because the user tabbed/clicked through the field without changing it.
    const onSkuChange = vi.fn();
    renderRow(onSkuChange, { parsed_sku: 'ABC-123' });
    const skuInput = screen.getByLabelText(/SKU \/ Barcode/i);
    fireEvent.blur(skuInput);
    expect(onSkuChange).not.toHaveBeenCalled();
  });

  it('re-commits on a focus + blur cycle when the prior commit never landed (retry after a failed write)', () => {
    // Regression: if updateLineItemMapping resolved false, item.parsed_sku (the source of truth)
    // never advances past its pre-edit value, but the old code's skuCommittedRef advanced
    // optimistically at blur time regardless of write outcome — permanently blocking a retry of
    // the same value. onFocus now re-baselines the ref from item.parsed_sku, so a focus + blur
    // with no intervening edit still re-fires the commit.
    const onSkuChange = vi.fn();
    renderRow(onSkuChange, { parsed_sku: null });
    const skuInput = screen.getByLabelText(/SKU \/ Barcode/i);
    fireEvent.change(skuInput, { target: { value: '999' } });
    fireEvent.blur(skuInput);
    expect(onSkuChange).toHaveBeenCalledTimes(1);

    // Simulate the parent's write having failed: item.parsed_sku prop is unchanged (still null),
    // so the next focus resets the baseline back to it, not to the failed attempt's '999'.
    fireEvent.focus(skuInput);
    fireEvent.blur(skuInput);
    expect(onSkuChange).toHaveBeenCalledTimes(2);
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
