import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ScanSessionView } from '@/components/inventory/ScanSessionView';
import type { Product } from '@/hooks/useProducts';

// ── External deps that are irrelevant to the session logic ───────────────────

// Mock @capacitor/core so jsdom doesn't error on Capacitor.isNativePlatform()
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// jsdom does not implement window.matchMedia — stub it so the component's
// mobile-detection guard doesn't throw.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// Mock the scanner: expose buttons that fire onScan, and reflect `active` for
// assertions via a data attribute.
vi.mock('@/components/SmartBarcodeScanner', () => ({
  SmartBarcodeScanner: ({ onScan, active }: { onScan: (gtin: string, format: string) => void; active?: boolean }) => (
    <div data-testid="scanner" data-active={String(active)}>
      <button onClick={() => onScan('111', 'EAN_13')}>emit-known</button>
      <button onClick={() => onScan('999', 'EAN_13')}>emit-new</button>
    </div>
  ),
}));

// QuickInventoryDialog — a minimal fake that shows "Quick Inventory" when open
vi.mock('@/components/QuickInventoryDialog', () => ({
  QuickInventoryDialog: ({ open, onOpenChange, product, onSave }: {
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    product?: { name?: string };
    onSave: (qty: number) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="quick-dialog" role="dialog">
        <p>Quick Inventory</p>
        <p>{product?.name}</p>
        <button
          onClick={async () => {
            await onSave(1);
          }}
        >
          save-quick
        </button>
        <button onClick={() => onOpenChange(false)}>cancel-quick</button>
      </div>
    ) : null,
}));

// ProductUpdateDialog and ProductUpdateSheet — minimal fakes
vi.mock('@/components/ProductUpdateDialog', () => ({
  ProductUpdateDialog: ({ open, onOpenChange, product, onUpdate }: {
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    product?: { name?: string };
    onUpdate: (updates: Record<string, unknown>, qty: number) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="update-dialog" role="dialog">
        <p>Product Update Dialog</p>
        <p>{product?.name}</p>
        <button
          onClick={async () => {
            await onUpdate({}, 0);
          }}
        >
          save-update
        </button>
        <button onClick={() => onOpenChange(false)}>cancel-update</button>
      </div>
    ) : null,
  ProductUpdateSheet: ({ open, onOpenChange, product, onUpdate }: {
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    product?: { name?: string };
    onUpdate: (updates: Record<string, unknown>, qty: number) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="update-sheet" role="dialog">
        <p>Product Update Sheet</p>
        <p>{product?.name}</p>
        <button
          onClick={async () => {
            await onUpdate({}, 0);
          }}
        >
          save-update
        </button>
        <button onClick={() => onOpenChange(false)}>cancel-update</button>
      </div>
    ) : null,
}));

// lucide-react icons — simple stubs
vi.mock('lucide-react', () => {
  const icon = (name: string) => ({ className, 'aria-hidden': ariaHidden }: { className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }) =>
    React.createElement('svg', { 'data-testid': `icon-${name}`, 'aria-hidden': ariaHidden, className });
  return {
    Package: icon('package'),
    Loader2: icon('loader2'),
    Check: icon('check'),
    ScanLine: icon('scanline'),
    X: icon('x'),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const known: Product = {
  id: 'p1',
  name: 'Roma Tomatoes',
  brand: 'Acme',
  current_stock: 4,
  uom_purchase: 'cans',
  restaurant_id: 'r1',
  gtin: '111',
  sku: '111',
  created_at: '',
  updated_at: '',
} as Product;

function setup(over: Partial<React.ComponentProps<typeof ScanSessionView>> = {}) {
  const props: React.ComponentProps<typeof ScanSessionView> = {
    restaurantId: 'r1',
    findProductByGtin: vi.fn(async (g: string) => (g === '111' ? known : null)),
    resolveNewProduct: vi.fn(
      async (g: string) =>
        ({
          id: '',
          gtin: g,
          name: 'New Product',
          sku: g,
          restaurant_id: 'r1',
          created_at: '',
          updated_at: '',
        } as Product),
    ),
    onAddQuantity: vi.fn(async () => {}),
    onUpdateProduct: vi.fn(async () => {}),
    onExit: vi.fn(),
    ...over,
  };
  render(React.createElement(ScanSessionView, props));
  return props;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ScanSessionView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scanner is active while scanning', () => {
    setup();
    expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'true');
  });

  it('known item opens the quick dialog and pauses the scanner', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-known'));
    // QuickInventoryDialog should appear
    await screen.findByText('Quick Inventory');
    // Scanner must be paused
    expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false');
  });

  it('a second emit while an entry is open does NOT open a second entry', async () => {
    const props = setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    // A second scan while quickEntry is open must be ignored
    fireEvent.click(screen.getByText('emit-new'));
    await waitFor(() =>
      expect((props.findProductByGtin as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1),
    );
    // No second dialog — still only one dialog in the DOM
    expect(screen.getAllByRole('dialog').length).toBe(1);
  });

  it('new item pauses the scanner', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-new'));
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false'),
    );
  });

  it('after commitQuick, scanner resumes', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    // Save the quick form
    fireEvent.click(screen.getByText('save-quick'));
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'true'),
    );
  });

  it('session counter increments after a successful save', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    fireEvent.click(screen.getByText('save-quick'));
    await waitFor(() =>
      // After commit, counter shows 1
      expect(screen.getByText(/1 added/i)).toBeInTheDocument(),
    );
  });

  it('cancel returns to scanning', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    fireEvent.click(screen.getByText('cancel-quick'));
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'true'),
    );
  });

  it('endSession calls onExit', async () => {
    const props = setup();
    fireEvent.click(screen.getByText('Done'));
    expect((props.onExit as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('camera layer is inert while an entry is open', async () => {
    setup();
    fireEvent.click(screen.getByText('emit-known'));
    await screen.findByText('Quick Inventory');
    // The camera wrapper should be inert while an entry overlay is open
    const cameraLayer = screen.getByTestId('scanner').parentElement;
    expect(cameraLayer).toHaveAttribute('inert');
  });

  it('scanner is inactive in lookingUp state', async () => {
    // findProductByGtin is controlled — defer resolution to observe mid-flight state
    let resolveFind!: (v: Product | null) => void;
    const findProductByGtin = vi.fn(
      () => new Promise<Product | null>((res) => { resolveFind = res; }),
    );
    setup({ findProductByGtin });
    fireEvent.click(screen.getByText('emit-known'));
    // Before resolve: state is lookingUp → scanner must be inactive
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false'),
    );
    // Resolve inside act so the subsequent state update is flushed cleanly
    await act(async () => { resolveFind(null); });
  });

  it('scanner is inactive in confirmed state', async () => {
    setup();
    // Get to fullEntry → confirmed
    fireEvent.click(screen.getByText('emit-new'));
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false'),
    );
    fireEvent.click(screen.getByText('save-update'));
    // After commitFull, state is confirmed — scanner must still be inactive
    await waitFor(() =>
      expect(screen.getByTestId('scanner')).toHaveAttribute('data-active', 'false'),
    );
    // The confirm beat overlay should appear
    await screen.findByText('Scan next item');
  });
});
