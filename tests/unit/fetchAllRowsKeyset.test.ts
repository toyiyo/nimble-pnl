import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAX_PAGES,
  SUPABASE_MAX_ROWS,
  fetchAllRows,
  fetchAllRowsKeyset,
  keysetAfterFilter,
  type KeysetCursor,
} from '../../supabase/functions/_shared/labor/fetchAllRows';

/**
 * Keyset paging reads the next page after the last (order key, id) that it
 * received. A write between two page requests does not move the next page.
 * The write cases mirror the TLA+ traces in
 * specs/tla/labor-loader-paging/LaborLoaderPaging.tla:
 * - LaborLoaderPaging_Offset.cfg: an insert before the page boundary gives a
 *   duplicate row with offset paging.
 * - LaborLoaderPaging_OffsetLostRow.cfg: a delete before the page boundary
 *   loses a stable row with offset paging.
 * - LaborLoaderPaging.cfg: keyset paging has neither problem.
 */
type Row = { id: string; punch_time: string };

const row = (n: number, time = `2026-07-20T0${Math.floor(n / 10)}:${String(n % 60).padStart(2, '0')}:00Z`): Row => ({
  id: `id-${String(n).padStart(3, '0')}`,
  punch_time: time,
});

const compare = (a: Row, b: Row) =>
  a.punch_time < b.punch_time ? -1 : a.punch_time > b.punch_time ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * A stub of a table sorted by (punch_time, id). `beforePage(n)` runs before
 * page request n (0-based), so a test can write to the table between pages.
 */
function makeTable(initial: Row[], beforePage: (page: number, table: Row[]) => void = () => {}) {
  const table = [...initial];
  let keysetPage = 0;
  let offsetPage = 0;
  const afters: Array<KeysetCursor<string> | null> = [];

  const keysetBuildPage = vi.fn((after: KeysetCursor<string> | null, pageSize: number) => {
    beforePage(keysetPage++, table);
    afters.push(after);
    const sorted = [...table].sort(compare);
    const rest = after
      ? sorted.filter((r) => r.punch_time > after.key || (r.punch_time === after.key && r.id > after.id))
      : sorted;
    return Promise.resolve({ data: rest.slice(0, pageSize), error: null });
  });

  const offsetBuildPage = vi.fn((from: number, to: number) => {
    beforePage(offsetPage++, table);
    const sorted = [...table].sort(compare);
    return Promise.resolve({ data: sorted.slice(from, to + 1), error: null });
  });

  return { table, keysetBuildPage, offsetBuildPage, afters };
}

const ids = (rows: Row[]) => rows.map((r) => r.id);
const hasNoDuplicate = (rows: Row[]) => new Set(ids(rows)).size === rows.length;

describe('fetchAllRowsKeyset', () => {
  it('reads three pages of a sorted table and asks for each page after the last (key, id)', async () => {
    const initial = Array.from({ length: 25 }, (_, i) => row(i));
    const { keysetBuildPage, afters } = makeTable(initial);

    const { rows, capped } = await fetchAllRowsKeyset<Row, 'punch_time'>(keysetBuildPage, 'punch_time', {
      pageSize: 10,
    });

    expect(ids(rows)).toEqual(ids(initial));
    expect(capped).toBe(false);
    expect(keysetBuildPage).toHaveBeenCalledTimes(3);
    expect(afters).toEqual([
      null,
      { key: initial[9].punch_time, id: initial[9].id },
      { key: initial[19].punch_time, id: initial[19].id },
    ]);
    expect(keysetBuildPage.mock.calls.every(([, size]) => size === 10)).toBe(true);
  });

  it('uses the id as the tie-break when rows share an order key', async () => {
    // All rows have the same punch_time, so only the id moves the cursor.
    const initial = Array.from({ length: 7 }, (_, i) => row(i, '2026-07-20T01:00:00Z'));
    const { keysetBuildPage } = makeTable(initial);

    const { rows } = await fetchAllRowsKeyset<Row, 'punch_time'>(keysetBuildPage, 'punch_time', { pageSize: 3 });

    expect(ids(rows)).toEqual(ids(initial));
  });

  it('uses the default page size of 1000 and the default maxPages', async () => {
    const buildPage = vi.fn(() => Promise.resolve({ data: [] as Row[], error: null }));

    const result = await fetchAllRowsKeyset<Row, 'punch_time'>(buildPage, 'punch_time');

    expect(buildPage).toHaveBeenCalledWith(null, SUPABASE_MAX_ROWS);
    expect(result).toEqual({ rows: [], capped: false });
    expect(DEFAULT_MAX_PAGES).toBe(20);
  });

  it('stops on a full last page followed by an empty page', async () => {
    const initial = Array.from({ length: 6 }, (_, i) => row(i));
    const { keysetBuildPage } = makeTable(initial);

    const { rows, capped } = await fetchAllRowsKeyset<Row, 'punch_time'>(keysetBuildPage, 'punch_time', {
      pageSize: 3,
    });

    expect(ids(rows)).toEqual(ids(initial));
    expect(capped).toBe(false);
    expect(keysetBuildPage).toHaveBeenCalledTimes(3);
  });

  it('gives no duplicate row when an insert lands before the page boundary between two pages', async () => {
    // Rows 2..5, page size 2. After page 1 (rows 2, 3), a writer inserts row 1.
    const initial = [row(2), row(3), row(4), row(5)];
    const inserted = row(1);
    const beforePage = (page: number, table: Row[]) => {
      if (page === 1) table.push(inserted);
    };

    const keyset = makeTable(initial, beforePage);
    const { rows } = await fetchAllRowsKeyset<Row, 'punch_time'>(keyset.keysetBuildPage, 'punch_time', {
      pageSize: 2,
    });
    expect(hasNoDuplicate(rows)).toBe(true);
    expect(ids(rows)).toEqual(ids(initial));

    // The same trace with offset paging returns row 3 twice.
    const offset = makeTable(initial, beforePage);
    const offsetResult = await fetchAllRows<Row>(offset.offsetBuildPage, { pageSize: 2 });
    expect(hasNoDuplicate(offsetResult.rows)).toBe(false);
  });

  it('loses no stable row when a delete lands before the page boundary between two pages', async () => {
    // Rows 2..5, page size 2. After page 1 (rows 2, 3), a writer deletes row 2.
    const initial = [row(2), row(3), row(4), row(5)];
    const beforePage = (page: number, table: Row[]) => {
      if (page === 1) table.splice(table.findIndex((r) => r.id === row(2).id), 1);
    };

    const keyset = makeTable(initial, beforePage);
    const { rows } = await fetchAllRowsKeyset<Row, 'punch_time'>(keyset.keysetBuildPage, 'punch_time', {
      pageSize: 2,
    });
    expect(hasNoDuplicate(rows)).toBe(true);
    // Rows 3, 4 and 5 were in the table for the whole read and nobody changed them.
    for (const stable of [row(3), row(4), row(5)]) {
      expect(ids(rows)).toContain(stable.id);
    }

    // The same trace with offset paging never reads stable row 4.
    const offset = makeTable(initial, beforePage);
    const offsetResult = await fetchAllRows<Row>(offset.offsetBuildPage, { pageSize: 2 });
    expect(ids(offsetResult.rows)).not.toContain(row(4).id);
  });

  it('gives no duplicate and no lost stable row for an insert and a delete between pages', async () => {
    const initial = Array.from({ length: 9 }, (_, i) => row(10 + i));
    const beforePage = (page: number, table: Row[]) => {
      if (page === 1) table.push(row(1)); // insert before the boundary
      if (page === 2) table.splice(table.findIndex((r) => r.id === row(10).id), 1); // delete before the boundary
    };
    const { keysetBuildPage } = makeTable(initial, beforePage);

    const { rows } = await fetchAllRowsKeyset<Row, 'punch_time'>(keysetBuildPage, 'punch_time', { pageSize: 3 });

    expect(hasNoDuplicate(rows)).toBe(true);
    for (const stable of initial.slice(1)) {
      expect(ids(rows)).toContain(stable.id);
    }
  });

  it('sets capped when the loop reaches maxPages', async () => {
    const initial = Array.from({ length: 30 }, (_, i) => row(i));
    const { keysetBuildPage } = makeTable(initial);

    const { rows, capped } = await fetchAllRowsKeyset<Row, 'punch_time'>(keysetBuildPage, 'punch_time', {
      pageSize: 10,
      maxPages: 2,
    });

    expect(capped).toBe(true);
    expect(rows).toHaveLength(20);
    expect(keysetBuildPage).toHaveBeenCalledTimes(2);
  });

  it('throws the page error', async () => {
    const pageError = { message: 'boom', code: '57014' };
    const buildPage = vi
      .fn()
      .mockResolvedValueOnce({ data: [row(1), row(2)], error: null })
      .mockResolvedValueOnce({ data: null, error: pageError });

    await expect(
      fetchAllRowsKeyset<Row, 'punch_time'>(buildPage, 'punch_time', { pageSize: 2 }),
    ).rejects.toBe(pageError);
  });
});

describe('keysetAfterFilter', () => {
  it('builds the PostgREST or() filter for the next page, with quoted values', () => {
    expect(keysetAfterFilter('punch_time', { key: '2026-07-20T01:00:00+00:00', id: 'abc' })).toBe(
      'punch_time.gt."2026-07-20T01:00:00+00:00",and(punch_time.eq."2026-07-20T01:00:00+00:00",id.gt."abc")',
    );
  });

  it('escapes a double quote and a backslash in a value', () => {
    expect(keysetAfterFilter('name', { key: 'a"b\\c', id: '1' })).toBe(
      'name.gt."a\\"b\\\\c",and(name.eq."a\\"b\\\\c",id.gt."1")',
    );
  });
});
