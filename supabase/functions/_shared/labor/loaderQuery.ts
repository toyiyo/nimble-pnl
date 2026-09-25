import { keysetAfterFilter, type KeysetCursor } from './fetchAllRows.ts';
import type { LaborQueryClient } from './types.ts';

/**
 * The query chain that the loaders use. The typed browser client and the Deno
 * supabase-js client both fit it at runtime. A full structural type of the
 * typed client fails with TS2589, so `fromTable` casts `client.from(table)`
 * to this chain in one type-only step (the same approach as `tipsFetch.ts`).
 */
export interface LoaderQuery {
  select(columns: string): LoaderQuery;
  eq(column: string, value: unknown): LoaderQuery;
  in(column: string, values: readonly unknown[]): LoaderQuery;
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
 * - When `after` is not null, the page starts after `after` in the order
 *   `(orderKey, id)` (`keysetAfterFilter`).
 * - The order is `orderKey` (with `orderOptions`, as the caller had it) and
 *   then `id`. When `orderKey` is `id`, the order is `id` only.
 * - The page is `.range(0, pageSize - 1)`: a limit of `pageSize` rows with
 *   no offset. Keyset paging never needs an offset.
 */
export function keysetPage<T>(
  query: LoaderQuery,
  orderKey: string,
  orderOptions: { ascending: boolean } | undefined,
  after: KeysetCursor<unknown> | null,
  pageSize: number,
): PromiseLike<{ data: T[] | null; error: unknown }> {
  const filtered = after ? query.or(keysetAfterFilter(orderKey, after)) : query;
  const ordered =
    orderKey === 'id'
      ? filtered.order('id')
      : (orderOptions ? filtered.order(orderKey, orderOptions) : filtered.order(orderKey)).order('id');
  return ordered.range(0, pageSize - 1) as PromiseLike<{ data: T[] | null; error: unknown }>;
}

/** Split `values` into chunks of at most `size` items. */
export function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}
