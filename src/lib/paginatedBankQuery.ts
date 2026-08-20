/** Row count per page. Matches the Supabase `.range()` page size used across the scan hooks. */
export const PAGE_SIZE = 1000;

/** Max pages to fetch before giving up and reporting `truncated: true`. */
export const MAX_PAGES = 20;

export interface PageResult<T> {
  data: T[] | null;
  error: Error | null;
}

export interface FetchAllPagesResult<T> {
  rows: T[];
  /** True when the fetch hit `MAX_PAGES` before a page came back short. */
  truncated: boolean;
}

/**
 * Fetch every row across a paged Supabase query, in `PAGE_SIZE` pages
 * ordered ascending by the caller's own `.order()` calls.
 *
 * `buildPage(from, to)` must run one `.range(from, to)` query and return
 * its `{ data, error }` result. Stops at the first page shorter than
 * `PAGE_SIZE`, at `MAX_PAGES`, or at the first page error.
 */
export async function fetchAllPages<T>(
  buildPage: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<FetchAllPagesResult<T>> {
  const rows: T[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildPage(from, to);

    if (error) throw error;

    const pageRows = data ?? [];
    rows.push(...pageRows);

    if (pageRows.length < PAGE_SIZE) {
      return { rows, truncated: false };
    }
  }

  return { rows, truncated: true };
}
