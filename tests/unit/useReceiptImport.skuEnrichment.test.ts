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
vi.mock('@/services/receiptTextNormalizer', () => ({
  ReceiptTextNormalizer: {
    loadCustomMappings: vi.fn().mockResolvedValue(undefined),
    generateSearchVariants: vi.fn().mockReturnValue([]),
    learnFromCorrection: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeLineItemsBuilder(rows: unknown[]) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn().mockResolvedValue({ data: rows, error: null });
  return builder;
}

function makeProductsBuilder(rows: unknown[]) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.in = vi.fn().mockResolvedValue({ data: rows, error: null });
  return builder;
}

function mockFromByTable(lineItemsBuilder: ReturnType<typeof makeLineItemsBuilder>, productsBuilder: ReturnType<typeof makeProductsBuilder>) {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'receipt_line_items') return lineItemsBuilder;
    if (table === 'products') return productsBuilder;
    throw new Error(`unexpected table: ${table}`);
  });
}

const baseRow = {
  id: 'li-1',
  receipt_id: 'r-1',
  raw_text: 'WIDGET 12CT',
  parsed_name: 'Widget',
  parsed_quantity: 1,
  parsed_unit: 'each',
  parsed_price: 10,
  matched_product_id: 'prod-1',
  confidence_score: 0.9,
  mapping_status: 'mapped',
  package_type: null,
  size_value: null,
  size_unit: null,
  pack_quantity: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('useReceiptImport — getReceiptLineItems SKU/Barcode auto-fill (Expectation A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects gtin and sku on the products enrichment query', async () => {
    const row = { ...baseRow, parsed_sku: null };
    const product = { id: 'prod-1', size_value: null, size_unit: null, uom_purchase: null, gtin: '012345678905', sku: 'SKU-1' };

    const lineItemsBuilder = makeLineItemsBuilder([row]);
    const productsBuilder = makeProductsBuilder([product]);
    mockFromByTable(lineItemsBuilder, productsBuilder);

    const { result } = renderHook(() => useReceiptImport());
    await result.current.getReceiptLineItems('r-1');

    expect(productsBuilder.select).toHaveBeenCalledWith(expect.stringContaining('gtin'));
    expect(productsBuilder.select).toHaveBeenCalledWith(expect.stringContaining('sku'));
  });

  it('auto-fills parsed_sku from the matched product gtin when the line item has none', async () => {
    const row = { ...baseRow, parsed_sku: null };
    const product = { id: 'prod-1', size_value: null, size_unit: null, uom_purchase: null, gtin: '012345678905', sku: 'SKU-1' };

    const lineItemsBuilder = makeLineItemsBuilder([row]);
    const productsBuilder = makeProductsBuilder([product]);
    mockFromByTable(lineItemsBuilder, productsBuilder);

    const { result } = renderHook(() => useReceiptImport());
    const items = await result.current.getReceiptLineItems('r-1');

    expect(items[0].parsed_sku).toBe('012345678905');
  });

  it('falls back to the matched product sku when gtin is empty', async () => {
    const row = { ...baseRow, parsed_sku: null };
    const product = { id: 'prod-1', size_value: null, size_unit: null, uom_purchase: null, gtin: null, sku: 'SKU-1' };

    const lineItemsBuilder = makeLineItemsBuilder([row]);
    const productsBuilder = makeProductsBuilder([product]);
    mockFromByTable(lineItemsBuilder, productsBuilder);

    const { result } = renderHook(() => useReceiptImport());
    const items = await result.current.getReceiptLineItems('r-1');

    expect(items[0].parsed_sku).toBe('SKU-1');
  });

  it('does not overwrite an existing (non-empty) parsed_sku', async () => {
    const row = { ...baseRow, parsed_sku: 'EXISTING-SKU' };
    const product = { id: 'prod-1', size_value: null, size_unit: null, uom_purchase: null, gtin: '012345678905', sku: 'SKU-1' };

    const lineItemsBuilder = makeLineItemsBuilder([row]);
    const productsBuilder = makeProductsBuilder([product]);
    mockFromByTable(lineItemsBuilder, productsBuilder);

    const { result } = renderHook(() => useReceiptImport());
    const items = await result.current.getReceiptLineItems('r-1');

    expect(items[0].parsed_sku).toBe('EXISTING-SKU');
  });

  it('leaves parsed_sku null when the matched product has neither gtin nor sku', async () => {
    const row = { ...baseRow, parsed_sku: null };
    const product = { id: 'prod-1', size_value: null, size_unit: null, uom_purchase: null, gtin: null, sku: null };

    const lineItemsBuilder = makeLineItemsBuilder([row]);
    const productsBuilder = makeProductsBuilder([product]);
    mockFromByTable(lineItemsBuilder, productsBuilder);

    const { result } = renderHook(() => useReceiptImport());
    const items = await result.current.getReceiptLineItems('r-1');

    expect(items[0].parsed_sku).toBeNull();
  });
});
