import { describe, it, expect, vi } from 'vitest';
import { fetchAllPages, PAGE_SIZE, MAX_PAGES } from '@/lib/paginatedBankQuery';

interface Row {
  id: number;
}

/** Builds a `buildPage` stub that returns `pages[page]` in order, by call count. */
function pagedStub(pages: Row[][]) {
  let call = 0;
  const buildPage = vi.fn(async (_from: number, _to: number) => {
    const data = pages[call] ?? [];
    call += 1;
    return { data, error: null };
  });
  return buildPage;
}

describe('fetchAllPages', () => {
  it('assembles rows from multiple pages into one ordered array', async () => {
    const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
    const page1 = [{ id: PAGE_SIZE }, { id: PAGE_SIZE + 1 }];
    const buildPage = pagedStub([page0, page1]);

    const result = await fetchAllPages<Row>(buildPage);

    expect(result.rows).toHaveLength(PAGE_SIZE + 2);
    expect(result.rows[0]).toEqual({ id: 0 });
    expect(result.rows[result.rows.length - 1]).toEqual({ id: PAGE_SIZE + 1 });
    expect(result.truncated).toBe(false);
    expect(buildPage).toHaveBeenCalledTimes(2);
  });

  it('passes ascending, non-overlapping from/to bounds sized to PAGE_SIZE', async () => {
    const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
    const page1 = [{ id: PAGE_SIZE }];
    const buildPage = pagedStub([page0, page1]);

    await fetchAllPages<Row>(buildPage);

    expect(buildPage).toHaveBeenNthCalledWith(1, 0, PAGE_SIZE - 1);
    expect(buildPage).toHaveBeenNthCalledWith(2, PAGE_SIZE, PAGE_SIZE * 2 - 1);
  });

  it('stops at MAX_PAGES and reports truncated when every page comes back full', async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
    const buildPage = vi.fn(async () => ({ data: fullPage, error: null }));

    const result = await fetchAllPages<Row>(buildPage);

    expect(buildPage).toHaveBeenCalledTimes(MAX_PAGES);
    expect(result.rows).toHaveLength(PAGE_SIZE * MAX_PAGES);
    expect(result.truncated).toBe(true);
  });

  it('reports truncated false when the last page is short of PAGE_SIZE', async () => {
    const shortPage = [{ id: 0 }, { id: 1 }];
    const buildPage = pagedStub([shortPage]);

    const result = await fetchAllPages<Row>(buildPage);

    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(buildPage).toHaveBeenCalledTimes(1);
  });

  it('treats a null data page as empty and stops', async () => {
    const buildPage = vi.fn(async () => ({ data: null, error: null }));

    const result = await fetchAllPages<Row>(buildPage);

    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(buildPage).toHaveBeenCalledTimes(1);
  });

  it('propagates a page error and stops fetching further pages', async () => {
    const boom = new Error('connection reset');
    const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: i }));
    const buildPage = vi.fn(async (_from: number, _to: number) => {
      if (buildPage.mock.calls.length === 1) {
        return { data: page0, error: null };
      }
      return { data: null, error: boom };
    });

    await expect(fetchAllPages<Row>(buildPage)).rejects.toBe(boom);
    expect(buildPage).toHaveBeenCalledTimes(2);
  });
});
