/**
 * Chart-of-accounts lookup for the AI tools (list_categories and the three
 * categorization write tools).
 *
 * This module is pure. It has no Deno imports, so Vitest can test it.
 */

/** Columns that list_categories and resolveCategoryRef read. */
export const CATEGORY_COLUMNS =
  'id, account_code, account_name, account_type, account_subtype, parent_account_id, is_active';

/** Maximum number of categories in one list_categories result. */
export const CATEGORY_LIST_CAP = 500;

export interface CategoryRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype: string;
  parent_account_id: string | null;
  is_active: boolean;
}

export interface CategoryList {
  categories: CategoryRow[];
  /** Number of rows that matched, before the cap. */
  count: number;
  truncated: boolean;
}

/**
 * Keeps the rows whose code or name contains `search` (no case), then the
 * first CATEGORY_LIST_CAP of them. The search runs here and not in a
 * PostgREST or() string, so its text cannot change the query.
 */
export function filterCategories(rows: CategoryRow[], search: string | undefined): CategoryList {
  const needle = (search ?? '').trim().toLowerCase();
  const matched = needle
    ? rows.filter(
        (row) =>
          row.account_code.toLowerCase().includes(needle) ||
          row.account_name.toLowerCase().includes(needle),
      )
    : rows;
  return {
    categories: matched.slice(0, CATEGORY_LIST_CAP),
    count: matched.length,
    truncated: matched.length > CATEGORY_LIST_CAP,
  };
}

type LookupResult = { data: CategoryRow | null; error: { message: string } | null };

interface LookupQuery {
  eq(column: string, value: string): LookupQuery;
  maybeSingle(): PromiseLike<LookupResult>;
}

/** The part of the Supabase client that resolveCategoryRef uses. */
export interface CategoryLookupClient {
  from(table: 'chart_of_accounts'): { select(columns: string): LookupQuery };
}

export type CategoryRefResult =
  | { ok: true; category: CategoryRow }
  | { ok: false; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findBy(
  supabase: CategoryLookupClient,
  restaurantId: string,
  column: 'id' | 'account_code',
  value: string,
): Promise<CategoryRow | null> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select(CATEGORY_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`Category lookup failed: ${error.message}`);
  return data;
}

/**
 * Finds a category of the restaurant by its id or by its account code.
 *
 * - The ref is trimmed. Its case is kept, because the unique key
 *   (restaurant_id, account_code) is case-sensitive.
 * - A UUID is looked up as an id first, then as a code: account_code is free
 *   text, so a code can have the shape of a UUID.
 * - A database error is thrown, so it does not show as "not found".
 * - An inactive account is refused.
 */
export async function resolveCategoryRef(
  supabase: CategoryLookupClient,
  restaurantId: string,
  ref: unknown,
): Promise<CategoryRefResult> {
  const value = typeof ref === 'string' ? ref.trim() : '';
  const notFound: CategoryRefResult = {
    ok: false,
    message: `Unknown category "${value}". Use a category id or an account code from list_categories.`,
  };
  if (!value) return notFound;

  let category: CategoryRow | null = null;
  if (UUID_PATTERN.test(value)) {
    category = await findBy(supabase, restaurantId, 'id', value);
  }
  category ??= await findBy(supabase, restaurantId, 'account_code', value);

  if (!category) return notFound;
  if (!category.is_active) {
    return {
      ok: false,
      message: `Category ${category.account_code} ${category.account_name} is inactive. Choose an active category.`,
    };
  }
  return { ok: true, category };
}
