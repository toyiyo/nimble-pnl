/** PostgREST's default `db-max-rows` — the row cap on any unpaginated
 * response. Used as the default page size so a single page never silently
 * truncates. */
export const SUPABASE_MAX_ROWS = 1000;

/** Hard backstop on pages fetched (20k rows at the default page size) —
 * avoids an unbounded loop on a runaway dataset. Surfaced via `capped`. */
export const DEFAULT_MAX_PAGES = 20;

export interface PagedResult<T> {
  rows: T[];
  /** True when the loop hit maxPages — results may be truncated. */
  capped: boolean;
}

/**
 * Fetches every row matching a query by paging through `.range()` windows,
 * defeating PostgREST's default 1000-row cap on unpaginated responses.
 *
 * The caller supplies `buildPage(from, to)`, which must return the same
 * query (select/filters/order) with `.range(from, to)` applied — this keeps
 * each call site's exact query shape intact while removing the duplicated
 * pagination loop.
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<PagedResult<T>> {
  const pageSize = opts?.pageSize ?? SUPABASE_MAX_ROWS;
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { rows, capped: false };
  }
  return { rows, capped: true };
}
