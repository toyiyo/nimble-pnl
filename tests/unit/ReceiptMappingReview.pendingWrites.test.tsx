/**
 * Regression: a failed field-edit write (e.g. the SKU/Barcode onBlur commit) must still block
 * bulk import even after it has already settled by the time the user clicks Import.
 *
 * handleBulkImport awaits `pendingUpdatesRef` before re-reading `receipt_line_items` fresh from
 * the DB (see ReceiptMappingReview.tsx). The original Set<Promise>-based implementation removed
 * every settled promise — success OR failure — via a bare `.finally()`, so a write that failed
 * and settled *before* Import was clicked left no trace: `Promise.allSettled` over the
 * (now-empty-of-that-entry) set would see no failure, and the import would proceed on the stale
 * DB value the guard exists to prevent. The fix keys tracking by itemId and only clears an
 * entry on success, so a failed write's outcome survives until a later successful retry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReceiptMappingReview } from '@/components/ReceiptMappingReview';

const updateLineItemMapping = vi.fn();
const bulkImportLineItems = vi.fn();
const toastSpy = vi.fn();

const baseItem = {
  id: 'item-1',
  receipt_id: 'r-1',
  raw_text: 'GULDENS MUSTARD PACKET',
  parsed_name: 'Guldens Mustard Packet',
  parsed_quantity: 1,
  parsed_unit: 'each',
  parsed_price: 29.96,
  parsed_sku: 'OLD-SKU',
  unit_price: 29.96,
  package_type: 'packet',
  size_value: 0.32,
  size_unit: 'oz',
  pack_quantity: 1,
  matched_product_id: 'product-1',
  confidence_score: 0.95,
  mapping_status: 'mapped',
  created_at: '2026-07-02T00:00:00Z',
  updated_at: '2026-07-02T00:00:00Z',
};

vi.mock('@/hooks/useReceiptImport', () => ({
  useReceiptImport: () => ({
    findSemanticDuplicate: vi.fn().mockResolvedValue(null),
    findDuplicateByHash: vi.fn().mockResolvedValue(null),
    getReceiptDetails: vi.fn().mockResolvedValue({
      id: 'r-1',
      restaurant_id: 'rest-123',
      vendor_name: 'Sysco',
      total_amount: 29.96,
      purchase_date: '2026-05-10',
      file_hash: 'abc',
      created_at: '2026-05-10T00:00:00Z',
      file_name: 'r.pdf',
      status: 'mapped',
    }),
    getReceiptLineItems: vi.fn().mockResolvedValue([{ ...baseItem }]),
    updateLineItemMapping,
    bulkImportLineItems,
    isUploading: false,
    isProcessing: false,
  }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({ products: [{ id: 'product-1', name: 'Guldens Mustard Packet' }], isLoading: false }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: [], createSupplier: vi.fn() }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
}));

function renderReview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReceiptMappingReview receiptId="r-1" onImportComplete={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ReceiptMappingReview — pending write tracking survives settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks bulk import when a field-edit write already failed before Import was clicked', async () => {
    updateLineItemMapping.mockResolvedValue(false); // every write in this test fails

    renderReview();

    // The single 'mapped' item lands in the collapsed "Ready to Import" (auto-approved) section.
    // Find its toggle by the section heading text (there's more than one "Show" button on
    // screen — the status bar has its own toggle too).
    const sectionHeading = await screen.findByText('Ready to Import');
    const showToggle = sectionHeading.closest('button');
    if (!showToggle) throw new Error('Ready to Import toggle button not found');
    fireEvent.click(showToggle);

    // Rows in the auto-approved tier also start collapsed individually — expand this one too.
    const rowToggle = await screen.findByLabelText(/click to expand/i);
    fireEvent.click(rowToggle);

    const skuInput = await screen.findByLabelText(/SKU \/ Barcode/i);
    fireEvent.change(skuInput, { target: { value: 'NEW-SKU' } });
    fireEvent.blur(skuInput);

    // Let the failed write settle (and, under the old bug, remove itself from tracking)
    // *before* the user clicks Import.
    await waitFor(() => expect(updateLineItemMapping).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const importButton = await screen.findByRole('button', { name: /import 1 item/i });
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unsaved changes',
          variant: 'destructive',
        }),
      );
    });
    expect(bulkImportLineItems).not.toHaveBeenCalled();
  });
});
