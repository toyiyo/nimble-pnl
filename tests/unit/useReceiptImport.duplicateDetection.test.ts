import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReceiptImport } from '@/hooks/useReceiptImport';

const mockSupabase = vi.hoisted(() => ({
  from: vi.fn(),
  storage: { from: vi.fn() },
  functions: { invoke: vi.fn() },
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

function makeSelectBuilder(resultData: unknown) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.neq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: resultData, error: null });
  return builder;
}

describe('useReceiptImport — findDuplicateByHash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries receipt_imports filtered by restaurant_id and file_hash, ordered DESC, limit 1', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findDuplicateByHash('rest-123', 'abc123');

    expect(mockSupabase.from).toHaveBeenCalledWith('receipt_imports');
    expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(builder.eq).toHaveBeenCalledWith('file_hash', 'abc123');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
    expect(builder.maybeSingle).toHaveBeenCalled();
    expect(dup).toBeNull();
  });

  it('returns the existing receipt when one matches', async () => {
    const existing = {
      id: 'r-1',
      restaurant_id: 'rest-123',
      file_hash: 'abc123',
      vendor_name: 'Sysco',
      total_amount: 1284.5,
      purchase_date: '2026-05-10',
      created_at: '2026-05-10T00:00:00Z',
    };
    const builder = makeSelectBuilder(existing);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findDuplicateByHash('rest-123', 'abc123');

    expect(dup).toEqual(existing);
  });
});

describe('useReceiptImport — findSemanticDuplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters by restaurant_id (eq), vendor (ilike), purchase_date (eq), total ±0.01 (gte/lte), excludeId (neq)', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    await result.current.findSemanticDuplicate(
      'rest-123',
      'Sysco',
      '2026-05-10',
      1284.5,
      'self-id',
    );

    expect(mockSupabase.from).toHaveBeenCalledWith('receipt_imports');
    expect(builder.eq).toHaveBeenCalledWith('restaurant_id', 'rest-123');
    expect(builder.ilike).toHaveBeenCalledWith('vendor_name', 'Sysco');
    expect(builder.eq).toHaveBeenCalledWith('purchase_date', '2026-05-10');
    expect(builder.gte).toHaveBeenCalledWith('total_amount', '1284.49');
    expect(builder.lte).toHaveBeenCalledWith('total_amount', '1284.51');
    expect(builder.neq).toHaveBeenCalledWith('id', 'self-id');
    expect(builder.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(builder.limit).toHaveBeenCalledWith(1);
  });

  it('trims surrounding whitespace from the vendor before ilike', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    await result.current.findSemanticDuplicate(
      'rest-123',
      '  Sysco  ',
      '2026-05-10',
      1284.5,
      'self-id',
    );

    expect(builder.ilike).toHaveBeenCalledWith('vendor_name', 'Sysco');
  });

  it('serializes the total to 2 decimal places (avoids float drift)', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    await result.current.findSemanticDuplicate(
      'rest-123',
      'Sysco',
      '2026-05-10',
      0.1 + 0.2,
      'self-id',
    );

    expect(builder.gte).toHaveBeenCalledWith('total_amount', '0.29');
    expect(builder.lte).toHaveBeenCalledWith('total_amount', '0.31');
  });

  it('returns null when no semantic match exists', async () => {
    const builder = makeSelectBuilder(null);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findSemanticDuplicate('rest-123', 'Sysco', '2026-05-10', 1284.5, 'self-id');

    expect(dup).toBeNull();
  });

  it('returns the existing receipt when a match exists', async () => {
    const existing = {
      id: 'r-2',
      restaurant_id: 'rest-123',
      vendor_name: 'Sysco',
      purchase_date: '2026-05-10',
      total_amount: 1284.5,
      created_at: '2026-05-09T00:00:00Z',
      file_hash: null,
    };
    const builder = makeSelectBuilder(existing);
    mockSupabase.from.mockReturnValue(builder);

    const { result } = renderHook(() => useReceiptImport());
    const dup = await result.current.findSemanticDuplicate(
      'rest-123', 'Sysco', '2026-05-10', 1284.5, 'self-id',
    );

    expect(dup).toEqual(existing);
  });
});
