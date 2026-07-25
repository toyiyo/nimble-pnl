/**
 * Task 3.3: Wire onCountProduct on <VirtualizedProductGrid> in Inventory.tsx
 *
 * Verifies that clicking "Count" on a product card (surfaced here via the
 * mocked VirtualizedProductGrid's onCountProduct callback) opens the
 * QuickInventoryDialog in 'add' mode for that exact product.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { ScanSessionViewProps } from '@/components/inventory/ScanSessionView';
import type { Product } from '@/hooks/useProducts';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const testProduct: Product = {
  id: 'p1',
  name: 'Tomatoes',
  sku: 'TOM-001',
  current_stock: 5,
  uom_purchase: 'kg',
} as Product;

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/components/SmartBarcodeScanner', () => ({
  SmartBarcodeScanner: () => <div data-testid="smart-scanner" />,
}));

vi.mock('@/components/inventory/ScanSessionView', () => ({
  ScanSessionView: (props: ScanSessionViewProps) => (
    <div data-testid="scan-session-view" data-restaurant-id={props.restaurantId}>
      scan-session-view
    </div>
  ),
}));

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

// This is the dialog under test — render its key props so we can assert on
// how Inventory.tsx wires the "Count" click through to it.
vi.mock('@/components/QuickInventoryDialog', () => ({
  QuickInventoryDialog: (props: {
    open: boolean;
    mode: 'add' | 'reconcile';
    product: Product;
  }) => (
    <div
      data-testid="quick-inventory-dialog"
      data-open={props.open}
      data-mode={props.mode}
      data-product-name={props.product?.name}
    />
  ),
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

// The component under test's collaborator: mocked to a single button that
// invokes onCountProduct with a known product, so we can assert Inventory.tsx
// wires it through to the dialog correctly without depending on the grid's
// own virtualization/rendering internals.
vi.mock('@/components/inventory/VirtualizedProductGrid', () => ({
  VirtualizedProductGrid: (props: { onCountProduct?: (product: Product) => void }) => (
    <div data-testid="virtualized-grid">
      <button onClick={() => props.onCountProduct?.(testProduct)}>
        trigger-count
      </button>
    </div>
  ),
}));

vi.mock('@/components/InventorySettings', () => ({
  InventorySettings: () => null,
}));
vi.mock('@/components/RestaurantSelector', () => ({
  RestaurantSelector: () => null,
}));

// Mock hooks
vi.mock('@/hooks/useProducts', () => ({
  useProducts: () => ({
    products: [testProduct],
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Inventory "Count" button wiring (Task 3.3)', () => {
  it('opens the QuickInventoryDialog in add mode for the counted product', async () => {
    const user = userEvent.setup();
    render(<Inventory />);

    // Products tab is the default — the grid (mocked) is already visible.
    expect(screen.getByTestId('virtualized-grid')).toBeInTheDocument();

    // Dialog is not rendered until a product is selected for quick-count.
    expect(screen.queryByTestId('quick-inventory-dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'trigger-count' }));

    const dialog = screen.getByTestId('quick-inventory-dialog');
    expect(dialog).toHaveAttribute('data-open', 'true');
    expect(dialog).toHaveAttribute('data-mode', 'add');
    expect(dialog).toHaveAttribute('data-product-name', 'Tomatoes');
  });
});
