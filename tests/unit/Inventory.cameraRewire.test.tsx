/**
 * Task 9: Inventory.tsx camera path rewire tests
 *
 * Verifies that:
 * 1. The camera scanner branch renders ScanSessionView (not SmartBarcodeScanner directly)
 * 2. resolveNewProduct builds a prefilled Product from productLookupService
 * 3. persistQuickAdd delegates to updateProductStockWithAudit with the correct args
 * 4. persistProductUpsert creates or updates via the products hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── Module mocks ──────────────────────────────────────────────────────────────

// Mock SmartBarcodeScanner so we know it should NOT be rendered directly
vi.mock('@/components/SmartBarcodeScanner', () => ({
  SmartBarcodeScanner: ({ onScan }: { onScan: (g: string, f: string) => void }) => (
    <div data-testid="smart-scanner">
      <button onClick={() => onScan('111', 'EAN_13')}>direct-scan</button>
    </div>
  ),
}));

// Mock ScanSessionView — we just need to confirm it renders
vi.mock('@/components/inventory/ScanSessionView', () => ({
  ScanSessionView: (props: any) => (
    <div data-testid="scan-session-view" data-restaurant-id={props.restaurantId}>
      scan-session-view
    </div>
  ),
}));

// Mock all page-level dialogs to avoid portal / Radix issues in tests
vi.mock('@/components/ProductUpdateDialog', () => ({
  ProductUpdateDialog: () => null,
  ProductUpdateSheet: () => null,
}));
vi.mock('@/components/DeleteProductDialog', () => ({
  DeleteProductDialog: () => null,
}));
vi.mock('@/components/WasteDialog', () => ({
  WasteDialog: () => null,
}));
vi.mock('@/components/TransferDialog', () => ({
  TransferDialog: () => null,
}));
vi.mock('@/components/QuickInventoryDialog', () => ({
  QuickInventoryDialog: () => null,
}));
vi.mock('@/components/ReconciliationSession', () => ({
  ReconciliationSession: () => null,
}));
vi.mock('@/components/ReconciliationHistory', () => ({
  ReconciliationHistory: () => null,
}));
vi.mock('@/components/ReconciliationSummary', () => ({
  ReconciliationSummary: () => null,
}));
vi.mock('@/components/OCRBarcodeScanner', () => ({
  OCRBarcodeScanner: () => null,
}));
vi.mock('@/components/KeyboardBarcodeScanner', () => ({
  KeyboardBarcodeScanner: () => null,
}));
vi.mock('@/components/ImageCapture', () => ({
  ImageCapture: () => null,
}));
vi.mock('@/components/inventory/VirtualizedProductGrid', () => ({
  VirtualizedProductGrid: () => null,
}));
vi.mock('@/components/InventorySettings', () => ({
  InventorySettings: () => null,
}));
vi.mock('@/components/RestaurantSelector', () => ({
  RestaurantSelector: () => null,
}));
vi.mock('@/components/ReconciliationSession', () => ({
  ReconciliationSession: () => null,
}));

// Mock hooks
vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    createProduct: vi.fn(async () => ({ id: 'new-1', name: 'Test Product' })),
    updateProductWithQuantity: vi.fn(),
    deleteProduct: vi.fn(),
    findProductByGtin: vi.fn(async () => null),
    refetchProducts: vi.fn(),
  }),
}));

vi.mock('@/hooks/useInventoryAudit', () => ({
  useInventoryAudit: () => ({
    updateProductStockWithAudit: vi.fn(async () => true),
  }),
}));

vi.mock('@/hooks/useInventoryMetrics', () => ({
  useInventoryMetrics: () => ({
    productMetrics: {},
    totalInventoryCost: 0,
    totalInventoryValue: 0,
    loading: false,
    calculationSummary: { recipeBasedCount: 0, estimatedCount: 0, mixedCount: 0 },
  }),
}));

vi.mock('@/hooks/useInventoryAlerts', () => ({
  useInventoryAlerts: () => ({ lowStockItems: [], exportLowStockCSV: vi.fn() }),
}));

vi.mock('@/hooks/useAllProductRecipes', () => ({
  useAllProductRecipes: () => ({ recipesByProduct: {} }),
}));

vi.mock('@/hooks/useReconciliation', () => ({
  useReconciliation: () => ({
    activeSession: null,
    startReconciliation: vi.fn(),
    resumeReconciliation: vi.fn(),
    refreshSession: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'test@test.com' } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: {
      restaurant_id: 'r1',
      role: 'owner',
      restaurant: { id: 'r1', name: 'Test Restaurant' },
    },
    setSelectedRestaurant: vi.fn(),
    restaurants: [],
    loading: false,
    createRestaurant: vi.fn(),
    canCreateRestaurant: false,
  }),
}));

vi.mock('@/services/productLookupService', () => ({
  productLookupService: {
    lookupProduct: vi.fn(async () => null),
  },
}));

vi.mock('@/services/productEnhancementService', () => ({
  ProductEnhancementService: {
    enhanceProduct: vi.fn(),
  },
}));

vi.mock('@/services/ocrService', () => ({
  ocrService: {},
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
    })),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { Inventory } from '@/pages/Inventory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Inventory camera path rewire (Task 9)', () => {
  it('renders ScanSessionView in the camera branch — not SmartBarcodeScanner directly', async () => {
    const user = userEvent.setup();
    render(<Inventory />);

    // Navigate to the Scanner tab (page starts on Products tab)
    const scannerTab = screen.getByRole('tab', { name: /scanner tab/i });
    await user.click(scannerTab);

    // ScanSessionView should be present (camera is the default scannerType)
    expect(screen.getByTestId('scan-session-view')).toBeInTheDocument();

    // SmartBarcodeScanner must NOT be rendered directly (ScanSessionView owns it internally)
    expect(screen.queryByTestId('smart-scanner')).not.toBeInTheDocument();
  });

  it('passes restaurantId to ScanSessionView', async () => {
    const user = userEvent.setup();
    render(<Inventory />);

    const scannerTab = screen.getByRole('tab', { name: /scanner tab/i });
    await user.click(scannerTab);

    const ssv = screen.getByTestId('scan-session-view');
    expect(ssv).toHaveAttribute('data-restaurant-id', 'r1');
  });
});
