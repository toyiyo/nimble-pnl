import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScanSession } from '@/hooks/useScanSession';
import type { Product } from '@/hooks/useProducts';

afterEach(() => vi.useRealTimers());

const product = (over: Partial<Product> = {}): Product =>
  ({ id: 'p1', name: 'Roma Tomatoes', gtin: '111', sku: '111', restaurant_id: 'r1', created_at: '', updated_at: '' } as Product);

function makeDeps(over: Partial<Parameters<typeof useScanSession>[0]> = {}) {
  return {
    findProductByGtin: vi.fn(async () => null),
    resolveNewProduct: vi.fn(async (gtin: string) => product({ id: '', gtin })),
    onError: vi.fn(),
    onExit: vi.fn(),
    ...over,
  };
}

describe('useScanSession', () => {
  it('starts in scanning with active=true and zero count', () => {
    const { result } = renderHook(() => useScanSession(makeDeps()));
    expect(result.current.state).toBe('scanning');
    expect(result.current.isScanning).toBe(true);
    expect(result.current.itemsThisSession).toBe(0);
  });

  it('known item → quickEntry; commitQuick increments count, suppresses code, auto-resumes', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));

    await act(async () => { await result.current.capture('111'); });
    expect(result.current.state).toBe('quickEntry');
    expect(result.current.isScanning).toBe(false);
    expect(result.current.activeProduct?.name).toBe('Roma Tomatoes');

    act(() => result.current.commitQuick());
    expect(result.current.state).toBe('scanning');
    expect(result.current.itemsThisSession).toBe(1);

    // the just-saved code is suppressed while still in frame
    await act(async () => { await result.current.capture('111'); });
    expect(result.current.state).toBe('scanning'); // gate rejected, no entry opened
  });

  it('new item → fullEntry; commitFull → confirmed; scanNext → scanning', async () => {
    const { result } = renderHook(() => useScanSession(makeDeps()));
    await act(async () => { await result.current.capture('999'); });
    expect(result.current.state).toBe('fullEntry');

    act(() => result.current.commitFull());
    expect(result.current.state).toBe('confirmed');
    expect(result.current.itemsThisSession).toBe(1);

    act(() => result.current.scanNext());
    expect(result.current.state).toBe('scanning');
  });

  it('ignores captures while not scanning (no duplicate entry)', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('111'); });
    expect(result.current.state).toBe('quickEntry');
    await act(async () => { await result.current.capture('222'); }); // should be ignored
    expect(deps.findProductByGtin).toHaveBeenCalledTimes(1);
  });

  it('cancelEntry returns to scanning and suppresses the code', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('111'); });
    act(() => result.current.cancelEntry());
    expect(result.current.state).toBe('scanning');
    expect(result.current.itemsThisSession).toBe(0);
  });

  it('endSession resets count + gate and calls onExit', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => product()) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('111'); });
    act(() => result.current.commitQuick());
    act(() => result.current.endSession());
    expect(deps.onExit).toHaveBeenCalled();
    expect(result.current.itemsThisSession).toBe(0);
  });

  it('treats a findProductByGtin rejection as not-found and opens fullEntry', async () => {
    const deps = makeDeps({ findProductByGtin: vi.fn(async () => { throw new Error('net'); }) });
    const { result } = renderHook(() => useScanSession(deps));
    await act(async () => { await result.current.capture('777'); });
    expect(result.current.state).toBe('fullEntry');
    expect(deps.resolveNewProduct).toHaveBeenCalledWith('777');
  });
});
