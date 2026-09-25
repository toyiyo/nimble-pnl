import {
  fetchAllRowsKeyset,
  keysetAfterFilter,
  type KeysetCursor,
  type PagedResult,
} from './fetchAllRows.ts';
import type { LaborQueryClient } from './types.ts';

/**
 * The query chain that the loaders use. The typed browser client and the Deno
 * supabase-js client both fit it at runtime. A full structural type of the
 * typed client fails with TS2589, so `fromTable` casts `client.from(table)`
 * to this chain in one type-only step.
 */
export interface LoaderQuery {
  select(columns: string): LoaderQuery;
  eq(column: string, value: unknown): LoaderQuery;
  in(column: string, values: readonly unknown[]): LoaderQuery;
  gt(column: string, value: string): LoaderQuery;
  gte(column: string, value: string): LoaderQuery;
  lte(column: string, value: string): LoaderQuery;
  lt(column: string, value: number): LoaderQuery;
  or(filters: string): LoaderQuery;
  order(column: string, options?: { ascending?: boolean; referencedTable?: string }): LoaderQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: unknown }>;
  maybeSingle(): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Type-only cast of `client.from(table)` to the loader chain. */
export function fromTable(client: LaborQueryClient, table: string): LoaderQuery {
  return client.from(table) as LoaderQuery;
}

/**
 * One keyset page of `query`, for `fetchAllRowsKeyset`.
 *
 * - The order is `orderKey` and then `id`, both ascending. When `orderKey`
 *   is `id`, the order is `id` only.
 * - When `after` is not null, the page starts after `after` in that order.
 *   For `id`, the filter is `.gt('id', after.id)`. For another key, it is
 *   `.gte(orderKey, after.key)` plus the `(orderKey, id)` cursor
 *   (`keysetAfterFilter`). The `gte` lets the index range start at the
 *   cursor, because PostgREST cannot use an index for the `or` alone.
 * - The page is `.range(0, pageSize - 1)`: a limit of `pageSize` rows with
 *   no offset. Keyset paging never needs an offset.
 */
export function keysetPage<T>(
  query: LoaderQuery,
  orderKey: string,
  after: KeysetCursor<unknown> | null,
  pageSize: number,
): PromiseLike<{ data: T[] | null; error: unknown }> {
  let filtered = query;
  if (after) {
    filtered =
      orderKey === 'id'
        ? query.gt('id', after.id)
        : query.gte(orderKey, String(after.key)).or(keysetAfterFilter(orderKey, after));
  }
  const ordered =
    orderKey === 'id'
      ? filtered.order('id', { ascending: true })
      : filtered.order(orderKey, { ascending: true }).order('id', { ascending: true });
  return ordered.range(0, pageSize - 1) as PromiseLike<{ data: T[] | null; error: unknown }>;
}

/**
 * Every row of the query that `build` returns, with keyset paging on
 * `(orderKey, id)`. `build` returns a new query (select and filters, no
 * order and no range) for each page. The order key column must be NOT NULL.
 */
export function fetchAllKeyset<T extends { id: string }, K extends keyof T & string = 'id'>(
  build: () => LoaderQuery,
  orderKey: K,
): Promise<PagedResult<T>> {
  return fetchAllRowsKeyset<T, K>(
    (after, pageSize) => keysetPage<T>(build(), orderKey, after, pageSize),
    orderKey,
  );
}

/** Split `values` into chunks of at most `size` items. */
export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
