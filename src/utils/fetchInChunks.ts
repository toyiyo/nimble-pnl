import type { PagedResult } from './fetchAllRows';

/** Default chunk size for `.in()` filters — keeps generated PostgREST URLs
 * comfortably under typical proxy/query-string length limits. */
export const DEFAULT_CHUNK_SIZE = 200;

/**
 * Splits `ids` into chunks of at most `chunkSize` and calls `fn` once per
 * chunk, concatenating the results in order.
 *
 * Designed to compose with `fetchAllRows`: `fn` typically wraps a
 * `.in('col', chunk)` query in a `fetchAllRows` call so that each chunk is
 * independently paginated (defeating the 1000-row cap) while the `.in()`
 * list itself stays bounded. Empty `ids` short-circuits without calling
 * `fn`.
 */
export async function fetchInChunks<TId, TRow>(
  ids: TId[],
  fn: (chunk: TId[]) => Promise<PagedResult<TRow>>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<PagedResult<TRow>> {
  const rows: TRow[] = [];
  let capped = false;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const result = await fn(chunk);
    rows.push(...result.rows);
    capped = capped || result.capped;
  }
  return { rows, capped };
}
