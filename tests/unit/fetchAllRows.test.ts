import { describe, it, expect, vi } from 'vitest';

import { fetchAllRows, SUPABASE_MAX_ROWS, DEFAULT_MAX_PAGES } from '@/utils/fetchAllRows';

type Row = { id: number };

/** Builds a `buildPage` fn backed by a fixed total row count, pageSize `size`. */
function makePagedSource(totalRows: number, size = SUPABASE_MAX_ROWS) {
  const calls: Array<[number, number]> = [];
  const buildPage = vi.fn((from: number, to: number) => {
    calls.push([from, to]);
    const rows: Row[] = [];
    for (let i = from; i <= to && i < totalRows; i++) {
      rows.push({ id: i });
    }
    return Promise.resolve({ data: rows, error: null });
  });
  return { buildPage, calls };
}

describe('fetchAllRows', () => {
  it('advances offsets across pages using the default page size', async () => {
    const { buildPage, calls } = makePagedSource(2500);

    await fetchAllRows<Row>(buildPage);

    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('returns all rows in order with no duplicates across page boundaries', async () => {
    const total = 2500;
    const { buildPage } = makePagedSource(total);

    const { rows } = await fetchAllRows<Row>(buildPage);

    expect(rows).toHaveLength(total);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: total }, (_, i) => i));
    // no duplicate ids
    expect(new Set(rows.map((r) => r.id)).size).toBe(total);
  });

  it('terminates with capped:false when the final page is short', async () => {
    const { buildPage } = makePagedSource(1039);

    const result = await fetchAllRows<Row>(buildPage);

    expect(result.capped).toBe(false);
    expect(result.rows).toHaveLength(1039);
  });

  it('reports capped:true when the loop is exhausted at maxPages', async () => {
    // Every page returned is exactly full (pageSize rows), so the loop never
    // sees a short page and must exit via the maxPages bound.
    const pageSize = 10;
    const maxPages = 3;
    const { buildPage } = makePagedSource(pageSize * maxPages, pageSize);

    const result = await fetchAllRows<Row>(buildPage, { pageSize, maxPages });

    expect(result.capped).toBe(true);
    expect(result.rows).toHaveLength(pageSize * maxPages);
  });

  it('propagates an error thrown from any page', async () => {
    const buildPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: 0 }], error: null })
      .mockResolvedValueOnce({ data: null, error: new Error('boom') });

    await expect(
      fetchAllRows<Row>(buildPage, { pageSize: 1, maxPages: 5 }),
    ).rejects.toThrow('boom');
  });

  it('respects a custom pageSize', async () => {
    const { buildPage, calls } = makePagedSource(25, 10);

    const result = await fetchAllRows<Row>(buildPage, { pageSize: 10 });

    expect(calls).toEqual([
      [0, 9],
      [10, 19],
      [20, 29],
    ]);
    expect(result.rows).toHaveLength(25);
    expect(result.capped).toBe(false);
  });

  it('respects a custom maxPages', async () => {
    // 5 full pages of 10 rows exist, but maxPages caps the loop at 2 pages.
    const { buildPage, calls } = makePagedSource(50, 10);

    const result = await fetchAllRows<Row>(buildPage, { pageSize: 10, maxPages: 2 });

    expect(calls).toEqual([
      [0, 9],
      [10, 19],
    ]);
    expect(result.rows).toHaveLength(20);
    expect(result.capped).toBe(true);
  });

  it('exposes the documented default constants', () => {
    expect(SUPABASE_MAX_ROWS).toBe(1000);
    expect(DEFAULT_MAX_PAGES).toBe(20);
  });
});
