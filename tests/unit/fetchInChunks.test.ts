import { describe, it, expect, vi } from 'vitest';

import { fetchInChunks } from '@/utils/fetchInChunks';
import { fetchAllRows, type PagedResult } from '@/utils/fetchAllRows';

type Row = { id: number };

describe('fetchInChunks', () => {
  it('chunks 450 ids into 3 requests of at most 200 each', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const fn = vi.fn(async (chunk: number[]): Promise<PagedResult<Row>> => ({
      rows: chunk.map((id) => ({ id })),
      capped: false,
    }));

    await fetchInChunks(ids, fn, 200);

    expect(fn).toHaveBeenCalledTimes(3);
    const calledChunks = fn.mock.calls.map(([chunk]) => chunk as number[]);
    expect(calledChunks.every((chunk) => chunk.length <= 200)).toBe(true);
    expect(calledChunks.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
  });

  it('concatenates results across chunks in order', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const fn = vi.fn(async (chunk: number[]): Promise<PagedResult<Row>> => ({
      rows: chunk.map((id) => ({ id })),
      capped: false,
    }));

    const { rows } = await fetchInChunks(ids, fn, 200);

    expect(rows).toHaveLength(450);
    expect(rows.map((r) => r.id)).toEqual(ids);
  });

  it('issues zero requests for empty input', async () => {
    const fn = vi.fn(async (): Promise<PagedResult<Row>> => ({ rows: [], capped: false }));

    const { rows, capped } = await fetchInChunks<number, Row>([], fn, 200);

    expect(fn).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
    expect(capped).toBe(false);
  });

  it('defaults the chunk size to 200 when not provided', async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i);
    const fn = vi.fn(async (chunk: number[]): Promise<PagedResult<Row>> => ({
      rows: chunk.map((id) => ({ id })),
      capped: false,
    }));

    await fetchInChunks(ids, fn);

    expect(fn).toHaveBeenCalledTimes(2);
    expect((fn.mock.calls[0][0] as number[]).length).toBe(200);
    expect((fn.mock.calls[1][0] as number[]).length).toBe(1);
  });

  it('propagates capped:true if any chunk reports capped', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const fn = vi
      .fn<(chunk: number[]) => Promise<PagedResult<Row>>>()
      .mockResolvedValueOnce({ rows: [], capped: false })
      .mockResolvedValueOnce({ rows: [], capped: true })
      .mockResolvedValueOnce({ rows: [], capped: false });

    const { capped } = await fetchInChunks(ids, fn, 200);

    expect(capped).toBe(true);
  });

  it('propagates an error thrown by any chunk', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => i);
    const fn = vi
      .fn<(chunk: number[]) => Promise<PagedResult<Row>>>()
      .mockResolvedValueOnce({ rows: [], capped: false })
      .mockRejectedValueOnce(new Error('boom'));

    await expect(fetchInChunks(ids, fn, 200)).rejects.toThrow('boom');
  });

  it('composes with fetchAllRows so each chunk is independently paginated', async () => {
    // Simulates the real Q3 usage: fn(chunk) itself pages through .range()
    // windows via fetchAllRows, and fetchInChunks concatenates across chunks.
    const ids = Array.from({ length: 250 }, (_, i) => i);
    // 300 rows "belong" to the chunk containing id 0, exercising fetchAllRows'
    // multi-page loop within a single chunk call.
    const fn = (chunk: number[]) =>
      fetchAllRows<Row>(
        (from, to) => {
          if (!chunk.includes(0)) {
            return Promise.resolve({ data: [], error: null });
          }
          const total = 300;
          const rows: Row[] = [];
          for (let i = from; i <= to && i < total; i++) rows.push({ id: i });
          return Promise.resolve({ data: rows, error: null });
        },
        { pageSize: 100 },
      );

    const { rows } = await fetchInChunks(ids, fn, 200);

    expect(rows).toHaveLength(300);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 300 }, (_, i) => i));
  });
});
