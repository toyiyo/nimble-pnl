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
 *
 * Chunks are fetched concurrently: they share no state and no chunk's query
 * depends on another's result, so awaiting them one at a time would just add
 * up their round trips — the exact cost this module exists to avoid. Results
 * are still concatenated in chunk order, because `Promise.all` preserves the
 * order of its input regardless of which request settles first.
 */
export async function fetchInChunks<TId, TRow>(
  ids: TId[],
  fn: (chunk: TId[]) => Promise<PagedResult<TRow>>,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<PagedResult<TRow>> {
  const chunks: TId[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }

  // `chunks.map(fn)` would hand `fn` map's index and array arguments too.
  const results = await Promise.all(chunks.map((chunk) => fn(chunk)));

  return {
    rows: results.flatMap((result) => result.rows),
    capped: results.some((result) => result.capped),
  };
}
