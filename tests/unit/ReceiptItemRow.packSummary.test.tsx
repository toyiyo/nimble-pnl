/**
 * Task 6: Receipt review UI — pack summary line + inner-unit package-definition copy
 *
 * RED: Written before UI changes.
 *   - pluralizeUnit helper does not yet exist
 *   - Pack summary line not rendered
 *   - Package Definition box still uses raw color classes + old copy
 * GREEN: Pass after ReceiptItemRow is updated per design spec.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
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

// ── Factory helpers ──────────────────────────────────────────────────────────

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
  onSkuChange: vi.fn(),
  onApplySuggestion: vi.fn(),
  onQuickFill: vi.fn(),
  categoryQuickFills: [],
};

function renderRow(itemOverrides: Partial<ReceiptLineItem> = {}) {
  const item = makeItem(itemOverrides);
  return render(<ReceiptItemRow item={item} {...defaultProps} />);
}

// ── Pack summary line tests ───────────────────────────────────────────────────

describe('ReceiptItemRow — pack summary line', () => {
  it('renders the pack breakdown when pack_quantity > 1 (mustard: 1 case × 500 = 500 packets)', () => {
    renderRow({ pack_quantity: 500, parsed_quantity: 500, package_type: 'packet' });
    // "1 case × 500 = 500 packets" — the × character must be the real multiplication sign
    // The pack summary line is the aria-live <p>
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl).not.toBeNull();
    expect(summaryEl?.textContent).toMatch(/1 case/);
    expect(summaryEl?.textContent).toContain('×');
    expect(summaryEl?.textContent).toMatch(/500/);
    expect(summaryEl?.textContent).toMatch(/packet/);
  });

  it('renders "2 cases" (plural) when cases > 1 (butter: 2 × 4 = 8 cans)', () => {
    renderRow({ pack_quantity: 4, parsed_quantity: 8, package_type: 'can' });
    // casesOrdered = 8/4 = 2 → "2 cases × 4 = 8 cans"
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl?.textContent).toMatch(/2 cases/);
  });

  it('uses aria-live="polite" on the pack summary paragraph', () => {
    renderRow({ pack_quantity: 500, parsed_quantity: 500, package_type: 'packet' });
    // The pack summary <p> must have aria-live so screen readers announce it
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl).not.toBeNull();
    expect(summaryEl).toHaveAttribute('aria-live', 'polite');
  });

  it('does NOT render the pack summary when pack_quantity is null (retail row)', () => {
    renderRow({ pack_quantity: null, parsed_quantity: 1, package_type: 'bag' });
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it('does NOT render the pack summary when pack_quantity === 1 (no multiplier, e.g. vodka)', () => {
    renderRow({ pack_quantity: 1, parsed_quantity: 1, package_type: 'bottle' });
    expect(screen.queryByText(/×/)).toBeNull();
  });

  it('uses the real × glyph (U+00D7), not the letter x', () => {
    renderRow({ pack_quantity: 500, parsed_quantity: 500, package_type: 'packet' });
    // U+00D7 MULTIPLICATION SIGN
    const multiplicationSign = '×';
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl?.textContent).toContain(multiplicationSign);
    // Must NOT have a bare " x " (letter x) as operator
    expect(summaryEl?.textContent).not.toMatch(/ x /);
  });
});

// ── Package Definition box tests ─────────────────────────────────────────────

describe('ReceiptItemRow — Package Definition box copy', () => {
  it('renders inner-unit copy "N units, each containing X size" when pack_quantity > 1', () => {
    renderRow({
      pack_quantity: 500,
      parsed_quantity: 500,
      package_type: 'packet',
      size_value: 0.32,
      size_unit: 'oz',
    });
    // Design: "500 packets, each containing 0.32 oz"
    expect(screen.getByText(/each containing/i)).toBeInTheDocument();
    expect(screen.getByText(/0\.32/)).toBeInTheDocument();
    expect(screen.getByText(/oz/)).toBeInTheDocument();
  });

  it('renders classic "1 unit containing X size" when pack_quantity is null', () => {
    renderRow({
      pack_quantity: null,
      parsed_quantity: 1,
      package_type: 'bottle',
      size_value: 750,
      size_unit: 'ml',
    });
    // Classic: "1 bottle containing 750 ml"
    expect(screen.getByText(/1 bottle containing/i)).toBeInTheDocument();
  });

  it('renders classic copy when pack_quantity === 1', () => {
    renderRow({
      pack_quantity: 1,
      parsed_quantity: 1,
      package_type: 'bottle',
      size_value: 750,
      size_unit: 'ml',
    });
    expect(screen.getByText(/1 bottle containing/i)).toBeInTheDocument();
  });

  it('does NOT render the Package Definition box when size info is missing', () => {
    renderRow({
      pack_quantity: 500,
      parsed_quantity: 500,
      package_type: 'packet',
      size_value: null,
      size_unit: null,
    });
    expect(screen.queryByText(/Your Package Definition/i)).toBeNull();
  });
});

// ── Semantic token tests (no raw green-* classes) ────────────────────────────

describe('ReceiptItemRow — Package Definition semantic tokens', () => {
  it('Package Definition box uses bg-muted/30 (semantic), not bg-green-*', () => {
    renderRow({
      pack_quantity: null,
      parsed_quantity: 1,
      package_type: 'bottle',
      size_value: 750,
      size_unit: 'ml',
    });
    // Find the Package Definition container and check its class
    const heading = screen.getByText(/Your Package Definition/i);
    const container = heading.closest('[class*="rounded"]');
    expect(container).not.toBeNull();
    // Must NOT have raw green classes
    expect(container?.className).not.toMatch(/bg-green-/);
    expect(container?.className).not.toMatch(/border-green-/);
    expect(container?.className).not.toMatch(/text-green-/);
  });

  it('checkmark span has aria-hidden="true"', () => {
    renderRow({
      pack_quantity: null,
      parsed_quantity: 1,
      package_type: 'bottle',
      size_value: 750,
      size_unit: 'ml',
    });
    // The ✓ span must be aria-hidden (decorative) — find all aria-hidden spans and
    // confirm at least one contains the checkmark
    const ariaHiddenEls = document.querySelectorAll('[aria-hidden="true"]');
    const checkSpans = Array.from(ariaHiddenEls).filter(el => el.textContent?.includes('✓'));
    expect(checkSpans.length).toBeGreaterThan(0);
    expect(checkSpans[0].tagName.toLowerCase()).toBe('span');
  });
});

// ── pluralizeUnit helper (exported from component module) ─────────────────────
// The helper is used internally; we test it via rendered output above.
// But we also want a direct unit test if it is exported.
describe('pluralizeUnit — singulars and plurals', () => {
  it('singular unit n=1: "packet" (not "packets")', () => {
    // We verify via the rendered DOM when parsed_quantity=1
    renderRow({
      pack_quantity: 2,
      parsed_quantity: 1,
      package_type: 'packet',
      size_value: 0.32,
      size_unit: 'oz',
    });
    // pack breakdown: "1 case × 2 = 1 packet" (singular)
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl?.textContent).toMatch(/1 packet\b/);
    expect(summaryEl?.textContent).not.toMatch(/packets/);
  });

  it('plural unit n>1: "cans" not "can"', () => {
    renderRow({
      pack_quantity: 4,
      parsed_quantity: 8,
      package_type: 'can',
      size_value: 5,
      size_unit: 'lb',
    });
    // pack breakdown: "2 cases × 4 = 8 cans"
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl?.textContent).toMatch(/8 cans/);
  });

  it('falls back to "units" when package_type is null', () => {
    renderRow({
      pack_quantity: 4,
      parsed_quantity: 4,
      package_type: null,
      parsed_unit: '',
      size_value: 5,
      size_unit: 'lb',
    });
    // breakdown: "1 case × 4 = 4 units"
    const summaryEl = document.querySelector('p[aria-live="polite"]');
    expect(summaryEl?.textContent).toMatch(/units/);
  });
});
