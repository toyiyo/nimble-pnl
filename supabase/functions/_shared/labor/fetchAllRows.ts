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
/**
 * Cast a Supabase query-builder chain to the page shape `fetchAllRows`
 * expects.
 *
 * The untyped client infers a many-to-one join (e.g. `foo!id(bar)`) as an
 * array, but PostgREST returns a single joined object at that key. This
 * asserts the caller's declared row type instead. It is a type-only cast —
 * it does not touch runtime behavior, so test mocks need no extra method
 * beyond `.range()`.
 */
export function asPagedRows<T>(
  query: unknown,
): PromiseLike<{ data: T[] | null; error: unknown }> {
  return query as unknown as PromiseLike<{ data: T[] | null; error: unknown }>;
}

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

/** The last row that a keyset page loop received: its order key and its id. */
export interface KeysetCursor<K> {
  key: K;
  id: string;
}

/**
 * Fetches every row matching a query by keyset paging on `(orderKey, id)`.
 *
 * The caller supplies `buildPage(after, pageSize)`. It must return the query
 * ordered by `orderKey` and then `id` (both ascending), limited to
 * `pageSize` rows, and, when `after` is not null, filtered to the rows after
 * `after` (see `keysetAfterFilter`). The helper asks for the next page after
 * the last `(key, id)` that it received.
 *
 * Offset paging (`fetchAllRows`) reads each page in its own snapshot, so an
 * insert or a delete before the page boundary between two requests moves the
 * offsets: the loop returns a row two times or skips a row that nobody
 * changed. Keyset paging does not depend on the offsets, so neither can
 * occur. See specs/tla/labor-loader-paging/LaborLoaderPaging.tla.
 *
 * A writer can change the order key of a row between two pages, so that the
 * row sorts after the cursor again. The helper then receives the row two
 * times. It keeps only the last copy of each id (the newer value, at its
 * position in the new order). See `LaborLoaderPaging_KeysetNoDedupe.cfg`.
 *
 * The order key column must be NOT NULL. PostgREST sorts a null last, and
 * the `gt` / `eq` cursor filter never matches a null, so a null key stops the
 * cursor. The helper throws on a row with a null or undefined order key.
 *
 * The page size, the `maxPages` cap and `capped` are the same as in
 * `fetchAllRows`. A page error is thrown.
 */
export async function fetchAllRowsKeyset<T extends { id: string }, K extends keyof T>(
  buildPage: (
    after: KeysetCursor<T[K]> | null,
    pageSize: number,
  ) => PromiseLike<{ data: T[] | null; error: unknown }>,
  orderKey: K,
  opts?: { pageSize?: number; maxPages?: number },
): Promise<PagedResult<T>> {
  const pageSize = opts?.pageSize ?? SUPABASE_MAX_ROWS;
  const maxPages = opts?.maxPages ?? DEFAULT_MAX_PAGES;
  // Insertion order is the read order. A later copy of an id replaces the
  // earlier one and moves to the end.
  const byId = new Map<string, T>();
  const result = (capped: boolean): PagedResult<T> => ({ rows: Array.from(byId.values()), capped });
  let after: KeysetCursor<T[K]> | null = null;
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await buildPage(after, pageSize);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row[orderKey] === null || row[orderKey] === undefined) {
        throw new Error(
          `fetchAllRowsKeyset: row ${row.id} has a null order key ${String(orderKey)}. The order key must be NOT NULL.`,
        );
      }
      byId.delete(row.id);
      byId.set(row.id, row);
    }
    if (!data || data.length < pageSize) return result(false);
    const last = data[data.length - 1];
    after = { key: last[orderKey], id: last.id };
  }
  return result(true);
}

/** A PostgREST filter value in double quotes, with `"` and `\` escaped. */
function quoteFilterValue(value: unknown): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The PostgREST `.or()` filter for the rows after `after` in the order
 * `(column, id)`: `column > key OR (column = key AND id > id)`. The values are
 * quoted, because a timestamp has `:` and `+` in it.
 */
export function keysetAfterFilter<K>(column: string, after: KeysetCursor<K>): string {
  const key = quoteFilterValue(after.key);
  return `${column}.gt.${key},and(${column}.eq.${key},id.gt.${quoteFilterValue(after.id)})`;
}
