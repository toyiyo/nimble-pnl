import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReceiptImport } from '@/hooks/useReceiptImport';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
  rpc: vi.fn(),
}));

const toastSpy = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({ supabase: mockSupabase }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock('@/contexts/RestaurantContext', () => ({
  useRestaurantContext: () => ({
    selectedRestaurant: { restaurant_id: 'rest-123' },
  }),
}));

// A thenable, chainable Postgrest-like builder: every filter/modifier method
// returns itself (for chaining), and awaiting the builder directly (no
// terminal .single()/.maybeSingle() call) resolves to `result` — matching how
// supabase-js query builders are both chainable and awaitable.
function makeThenableBuilder(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};
  ['select', 'eq', 'in', 'order', 'update', 'insert', 'upsert'].forEach((method) => {
    builder[method] = vi.fn(() => builder);
  });
  builder.single = vi.fn().mockResolvedValue(result);
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  (builder as { then: unknown }).then = (
    onFulfilled?: (value: typeof result) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<typeof result>;
}

const baseLineItem = {
  id: 'li-1',
  receipt_id: 'r-1',
  raw_text: 'WIDGET 12CT',
  parsed_name: 'Widget',
  parsed_quantity: 2,
  parsed_unit: 'each',
  parsed_price: 20,
  unit_price: null,
  matched_product_id: 'prod-1',
  confidence_score: 0.9,
  mapping_status: 'mapped',
  parsed_sku: null as string | null,
};

interface Setup {
  lineItems?: Array<Record<string, unknown>>;
  productSelectResult?: { data: unknown; error: unknown };
  productUpdateResult?: { data: unknown; error: unknown };
}

function setupMocks({
  lineItems = [baseLineItem],
  productSelectResult = { data: { current_stock: 5, receipt_item_names: [] }, error: null },
  productUpdateResult = { data: { id: 'prod-1' }, error: null },
}: Setup = {}) {
  const lineItemsBuilder = makeThenableBuilder({ data: lineItems, error: null });
  const receiptImportsReadBuilder = makeThenableBuilder({
    data: { vendor_name: 'Sysco', supplier_id: null, purchase_date: '2026-01-01' },
    error: null,
  });
  const receiptImportsUpdateBuilder = makeThenableBuilder({ data: null, error: null });

  const productSelectBuilder = makeThenableBuilder(productSelectResult);
  const productUpdateBuilder = makeThenableBuilder(productUpdateResult);

  const inventoryTransactionsBuilder = makeThenableBuilder({ data: null, error: null });

  let receiptImportsCallCount = 0;
  let productsCallCount = 0;

  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'receipt_line_items') return lineItemsBuilder;
    if (table === 'receipt_imports') {
      receiptImportsCallCount += 1;
      return receiptImportsCallCount === 1 ? receiptImportsReadBuilder : receiptImportsUpdateBuilder;
    }
    if (table === 'products') {
      productsCallCount += 1;
      return productsCallCount === 1 ? productSelectBuilder : productUpdateBuilder;
    }
    if (table === 'inventory_transactions') return inventoryTransactionsBuilder;
    throw new Error(`unexpected table: ${table}`);
  });

  return { productSelectBuilder, productUpdateBuilder, lineItemsBuilder };
}

describe('useReceiptImport — bulkImportLineItems mapped-branch barcode write-back (Expectation B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads current_stock and receipt_item_names in a single restaurant_id-scoped select', async () => {
    const { productSelectBuilder } = setupMocks();

    const { result } = renderHook(() => useReceiptImport());
    await result.current.bulkImportLineItems('r-1');

    expect(productSelectBuilder.select).toHaveBeenCalledTimes(1);
    expect(productSelectBuilder.select).toHaveBeenCalledWith(expect.stringContaining('current_stock'));
    expect(productSelectBuilder.select).toHaveBeenCalledWith(expect.stringContaining('receipt_item_names'));
    expect(productSelectBuilder.eq).toHaveBeenCalledWith('id', 'prod-1');
    expect(productSelectBuilder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(productSelectBuilder.maybeSingle).toHaveBeenCalled();
  });

  it('writes the edited parsed_sku to product.gtin on the scoped update', async () => {
    const { productUpdateBuilder } = setupMocks({
      lineItems: [{ ...baseLineItem, parsed_sku: '012345678905' }],
    });

    const { result } = renderHook(() => useReceiptImport());
    await result.current.bulkImportLineItems('r-1');

    expect(productUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ gtin: '012345678905' }),
    );
    expect(productUpdateBuilder.eq).toHaveBeenCalledWith('id', 'prod-1');
    expect(productUpdateBuilder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(productUpdateBuilder.select).toHaveBeenCalledWith('id');
    expect(productUpdateBuilder.maybeSingle).toHaveBeenCalled();
  });

  it('trims whitespace before writing the barcode back', async () => {
    const { productUpdateBuilder } = setupMocks({
      lineItems: [{ ...baseLineItem, parsed_sku: '  012345678905  ' }],
    });

    const { result } = renderHook(() => useReceiptImport());
    await result.current.bulkImportLineItems('r-1');

    expect(productUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ gtin: '012345678905' }),
    );
  });

  it.each([null, '', '   '])(
    'omits gtin from the update when parsed_sku is %p',
    async (parsedSku) => {
      const { productUpdateBuilder } = setupMocks({
        lineItems: [{ ...baseLineItem, parsed_sku: parsedSku }],
      });

      const { result } = renderHook(() => useReceiptImport());
      await result.current.bulkImportLineItems('r-1');

      const updateCall = productUpdateBuilder.update.mock.calls[0][0] as Record<string, unknown>;
      expect(updateCall).not.toHaveProperty('gtin');
    },
  );

  it('never includes a sku key in the update payload (write-back targets gtin only)', async () => {
    const { productUpdateBuilder } = setupMocks({
      lineItems: [{ ...baseLineItem, parsed_sku: 'ABC-123' }],
    });

    const { result } = renderHook(() => useReceiptImport());
    await result.current.bulkImportLineItems('r-1');

    const updateCall = productUpdateBuilder.update.mock.calls[0][0] as Record<string, unknown>;
    expect(updateCall).not.toHaveProperty('sku');
  });

  it('skips the item without throwing when the scoped read returns no row (stale/cross-tenant match)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { productUpdateBuilder } = setupMocks({
      productSelectResult: { data: null, error: null },
    });

    const { result } = renderHook(() => useReceiptImport());
    const ok = await result.current.bulkImportLineItems('r-1');

    expect(ok).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(productUpdateBuilder.update).not.toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('0 items') }),
    );

    consoleErrorSpy.mockRestore();
  });

  it('treats a 0-row (silent no-op) update result as a logged failure, not a success', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupMocks({
      productUpdateResult: { data: null, error: null },
    });

    const { result } = renderHook(() => useReceiptImport());
    const ok = await result.current.bulkImportLineItems('r-1');

    expect(ok).toBe(true);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('0 items') }),
    );

    consoleErrorSpy.mockRestore();
  });
});
