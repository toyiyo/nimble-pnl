import { describe, it, expect, vi } from 'vitest';
import { readAllPages, type PagedQuery } from '../../supabase/functions/_shared/pagedRead';

type Row = { id: string };

function makeBuilder(rows: Row[], maxRows: number, failOnCall?: number) {
  let calls = 0;
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return () => {
    let after: string | null = null;
    let ascending: boolean | null = null;
    const q: PagedQuery = {
      gt(_c, v) { after = v; return q; },
      order(_c, opts) { ascending = opts.ascending; return q; },
      limit(n) {
        calls++;
        if (failOnCall === calls) return Promise.resolve({ data: null, error: { message: 'boom' } });
        // Rows come back in input order unless the query asks for an ascending order.
        const source = ascending ? sorted : rows;
        const rest = after === null ? source : source.filter((r) => r.id > after!);
        return Promise.resolve({ data: rest.slice(0, Math.min(n, maxRows)), error: null });
      },
    };
    return q;
  };
}

const rows: Row[] = ['c', 'a', 'e', 'b', 'd'].map((id) => ({ id }));

describe('readAllPages', () => {
  it('reads all rows across pages and stops on an empty page', async () => {
    const out = await readAllPages<Row>('t', makeBuilder(rows, 2), 2);
    expect(out?.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('keeps reading when max_rows is lower than the page size', async () => {
    const out = await readAllPages<Row>('t', makeBuilder(rows, 2), 1000);
    expect(out).toHaveLength(5);
  });

  it('returns an empty list for an empty table', async () => {
    expect(await readAllPages<Row>('t', makeBuilder([], 2))).toEqual([]);
  });

  it('returns null when a page read fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await readAllPages<Row>('t', makeBuilder(rows, 2, 2), 2)).toBeNull();
    spy.mockRestore();
  });
});
