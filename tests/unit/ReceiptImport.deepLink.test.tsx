import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ReceiptImport } from '@/pages/ReceiptImport';

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
    restaurants: [],
  }),
}));

vi.mock('@/hooks/useReceiptImport', () => ({
  useReceiptImport: () => ({
    uploadReceipt: vi.fn(),
    processReceipt: vi.fn(),
    findDuplicateByHash: vi.fn(),
    findSemanticDuplicate: vi.fn().mockResolvedValue(null),
    getReceiptImports: vi.fn().mockResolvedValue([
      { id: 'r-deep', file_name: 'deep.pdf', status: 'uploaded', created_at: '2026-05-12T00:00:00Z' },
    ]),
    getReceiptDetails: vi.fn().mockResolvedValue({
      id: 'r-deep',
      restaurant_id: 'rest-123',
      vendor_name: null,
      total_amount: null,
      purchase_date: null,
      file_hash: null,
      file_name: 'deep.pdf',
      status: 'uploaded',
      created_at: '2026-05-12T00:00:00Z',
    }),
    getReceiptLineItems: vi.fn().mockResolvedValue([]),
    updateLineItemMapping: vi.fn(),
    bulkImportLineItems: vi.fn(),
    isUploading: false,
    isProcessing: false,
  }),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    subscription: { tier: 'pro', status: 'active' },
    hasFeature: () => true,
    isLoading: false,
  }),
}));

vi.mock('@/components/subscription', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFeatureAccess: () => ({ hasAccess: true }),
}));

vi.mock('@/components/MetricIcon', () => ({
  MetricIcon: () => <span data-testid="metric-icon" />,
}));

vi.mock('@/components/ReceiptMappingReview', () => ({
  ReceiptMappingReview: ({ receiptId }: { receiptId: string }) => (
    <div data-testid="receipt-mapping-review" data-receipt-id={receiptId}>
      Receipt Mapping Review
    </div>
  ),
}));

describe('ReceiptImport — deep-link initialization', () => {
  it('opens the receipt indicated by ?receipt=<id> on first render (no flicker)', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/receipt-import?receipt=r-deep']}>
          <Routes>
            <Route path="/receipt-import" element={<ReceiptImport />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // The receipt review view should mount on first render — the upload card
    // (titled "Upload Receipt") should NOT appear first.
    expect(screen.queryByRole('tab', { name: /Upload Receipt/i })).not.toBeInTheDocument();
  });
});
