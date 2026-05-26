import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReceiptMappingReview } from '@/components/ReceiptMappingReview';

const findSemanticDuplicate = vi.fn();
const findDuplicateByHash = vi.fn();

vi.mock('@/hooks/useReceiptImport', () => ({
  useReceiptImport: () => ({
    findSemanticDuplicate,
    findDuplicateByHash,
    getReceiptDetails: vi.fn().mockResolvedValue({
      id: 'r-1',
      restaurant_id: 'rest-123',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      file_hash: 'abc',
      created_at: '2026-05-10T00:00:00Z',
      file_name: 'r.pdf',
      status: 'mapped',
    }),
    getReceiptLineItems: vi.fn().mockResolvedValue([]),
    updateLineItemMapping: vi.fn(),
    bulkImportLineItems: vi.fn(),
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
  useProducts: () => ({ products: [], isLoading: false }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: [], createSupplier: vi.fn() }),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
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

describe('ReceiptMappingReview — semantic duplicate banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a skeleton while the semantic-dup query is in flight', async () => {
    let resolveQuery!: (value: unknown) => void;
    findSemanticDuplicate.mockImplementation(
      () => new Promise((res) => { resolveQuery = res; }),
    );

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('semantic-dup-skeleton')).toBeInTheDocument();
    });

    resolveQuery(null);
  });

  it('renders the amber banner with role=status when a semantic match is returned', async () => {
    findSemanticDuplicate.mockResolvedValue({
      id: 'r-prev',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-09T00:00:00Z',
    });

    renderReview();

    const banner = await screen.findByRole('status');
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(within(banner).getByText(/similar receipt/i)).toBeInTheDocument();
    expect(within(banner).getByText(/Sysco/)).toBeInTheDocument();
  });

  it('renders nothing when no semantic match', async () => {
    findSemanticDuplicate.mockResolvedValue(null);
    renderReview();
    await waitFor(() => {
      expect(findSemanticDuplicate).toHaveBeenCalled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('hides the banner when dismissed (session-only)', async () => {
    findSemanticDuplicate.mockResolvedValue({
      id: 'r-prev',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-09T00:00:00Z',
    });

    renderReview();
    const banner = await screen.findByRole('status');
    fireEvent.click(within(banner).getByRole('button', { name: /dismiss/i }));

    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });
});
