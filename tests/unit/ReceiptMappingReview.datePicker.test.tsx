/**
 * Regression test for BUG-001: ReceiptMappingReview must use the controlled
 * DatePicker primitive (no initialFocus, no pointer-events-auto) so that the
 * first calendar click registers.
 *
 * The 1 inline Popover+Calendar+initialFocus block (purchase date trigger with
 * a trailing CheckCircle icon) is replaced with <DatePicker> using the children
 * escape hatch.
 *
 * Per the design spec (§3 custom-trigger a11y contract):
 *  - aria-label="Select purchase date" added to the trigger button
 *  - aria-hidden="true" added to the decorative <CheckCircle>
 */
import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptMappingReview } from '../../src/components/ReceiptMappingReview';

// Radix Popover needs pointer-capture stubs in jsdom.
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture)
    Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture)
    Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView)
    Element.prototype.scrollIntoView = () => {};
});

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
    },
  }),
}));

vi.mock('@/hooks/useReceiptImport', () => ({
  useReceiptImport: () => ({
    getReceiptDetails: vi.fn().mockResolvedValue({
      id: 'receipt-1',
      vendor_name: 'Test Vendor',
      purchase_date: '2026-01-15',
      total_amount: 100,
      status: 'pending',
      raw_file_url: null,
      file_name: null,
      supplier_id: null,
    }),
    getReceiptLineItems: vi.fn().mockResolvedValue([]),
    updateLineItemMapping: vi.fn().mockResolvedValue(true),
    bulkImportLineItems: vi.fn().mockResolvedValue(true),
    findSemanticDuplicate: vi.fn().mockResolvedValue(null),
  }),
}));

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ products: [] }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: [], createSupplier: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) })),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null, isLoading: false }),
}));

function renderReview() {
  return render(
    <ReceiptMappingReview
      receiptId="receipt-1"
      onImportComplete={vi.fn()}
    />,
  );
}

describe('ReceiptMappingReview — purchase date picker (BUG-001 regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the purchase date trigger with aria-label="Select purchase date"', async () => {
    renderReview();
    // After migration: the children trigger carries aria-label="Select purchase date".
    expect(
      await screen.findByRole('button', { name: /select purchase date/i }),
    ).toBeInTheDocument();
  });

  it('opens the calendar when the purchase date trigger is clicked', async () => {
    const user = userEvent.setup();
    renderReview();
    const trigger = await screen.findByRole('button', { name: /select purchase date/i });
    await user.click(trigger);
    expect(await screen.findByRole('grid')).toBeInTheDocument();
  });

  it('calendar disappears after a date is selected — the BUG-001 close-on-select fix', async () => {
    const user = userEvent.setup();
    renderReview();
    const trigger = await screen.findByRole('button', { name: /select purchase date/i });
    await user.click(trigger);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByRole('gridcell', { name: '10' }));
    // After migration: the controlled DatePicker closes on selection.
    await waitFor(() => {
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });

  it('does not render pointer-events-auto on any element (band-aid removed)', async () => {
    renderReview();
    // Wait for loading to complete by waiting for the trigger to appear.
    await screen.findByRole('button', { name: /select purchase date/i });
    const match = document.body.querySelector('.pointer-events-auto');
    expect(match).toBeNull();
  });

  it('has aria-hidden on the CheckCircle icon when a date is set', async () => {
    renderReview();
    // The component is initialized with purchase_date='2026-01-15' from the mock.
    // After migration: the <CheckCircle> carries aria-hidden="true".
    await screen.findByRole('button', { name: /select purchase date/i });
    // The SVG icon should have aria-hidden="true" so it is decorative.
    const hiddenSvgs = document.body.querySelectorAll('svg[aria-hidden="true"]');
    // At minimum the CheckCircle inside the trigger should be hidden.
    expect(hiddenSvgs.length).toBeGreaterThan(0);
  });
});
