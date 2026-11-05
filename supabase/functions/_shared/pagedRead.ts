// Keyset page reader for edge functions. No Supabase import, so vitest can test it.
// The server max_rows can be lower than the page size, so the loop stops on an empty page.

export const PAGE_SIZE = 1000;

export interface PagedQuery {
  gt(column: string, value: string): PagedQuery;
  order(column: string, opts: { ascending: boolean }): PagedQuery;
  limit(count: number): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** Read all rows of a query in pages, by keyset on `id`. Return null when a page read fails. */
export async function readAllPages<T extends { id: string }>(
  label: string,
  buildQuery: () => PagedQuery,
  pageSize: number = PAGE_SIZE,
): Promise<T[] | null> {
  const all: T[] = [];
  let lastId: string | null = null;
  while (true) {
    let q = buildQuery();
    if (lastId !== null) q = q.gt("id", lastId);
    const { data, error } = await q.order("id", { ascending: true }).limit(pageSize);
    if (error) {
      console.error(`[SYNC-TRANSACTIONS] Error reading ${label} - skipping the store step:`, error.message);
      return null;
    }
    const page = (data ?? []) as T[];
    all.push(...page);
    if (page.length === 0) return all;
    lastId = page[page.length - 1].id;
  }
}
