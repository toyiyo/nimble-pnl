/**
 * Chart-of-accounts lookup for the AI tools (list_categories and the three
 * categorization write tools).
 *
 * This module is pure. It has no Deno imports, so Vitest can test it.
 */

/** Columns that list_categories and resolveCategoryRef read. */
export const CATEGORY_COLUMNS =
  'id, account_code, account_name, account_type, account_subtype, parent_account_id, is_active';

/**
 * Maximum number of categories in one list_categories result. A row is about
 * 245 characters of JSON, and the connector cuts a tool result at 40,000
 * characters (MAX_TOOL_TEXT_CHARS in mcpHandler.ts).
 */
export const CATEGORY_LIST_CAP = 150;

/**
 * Maximum JSON size of the listed categories. It leaves room under the
 * 40,000-character connector limit for the result envelope, because
 * account_name is free text and a long name makes a row larger.
 */
export const CATEGORY_TEXT_BUDGET = 36_000;

/** The values of account_type_enum. */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Trims and lowercases a string from the model, so "Expense" matches the enum.
 * Any other value comes back unchanged.
 */
export function normalizeAccountType(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

/** True for one of the six account_type_enum values, with its exact spelling. */
export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export interface CategoryRow {
  id: string;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  account_subtype: string;
  parent_account_id: string | null;
  is_active: boolean;
}

/** A listed category. is_active is left out when only active rows are listed. */
export type ListedCategory = Omit<CategoryRow, 'is_active'> & { is_active?: boolean };

/** count and truncated come first, so a result cut at the end keeps them. */
export interface CategoryList {
  /** Number of rows that matched, before the cap. */
  count: number;
  truncated: boolean;
  categories: ListedCategory[];
}

/**
 * Keeps the rows whose code or name contains `search` (no case), then the
 * first rows up to CATEGORY_LIST_CAP and CATEGORY_TEXT_BUDGET. The search
 * runs here and not in a PostgREST or() string, so its text cannot change
 * the query.
 */
export function filterCategories(
  rows: CategoryRow[],
  search: string | undefined,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): CategoryList {
  const needle = (search ?? '').trim().toLowerCase();
  const matched = needle
    ? rows.filter(
        (row) =>
          row.account_code.toLowerCase().includes(needle) ||
          row.account_name.toLowerCase().includes(needle),
      )
    : rows;
  const categories: ListedCategory[] = [];
  let size = 2; // the brackets of the JSON array
  for (const row of matched.slice(0, CATEGORY_LIST_CAP)) {
    const listed: ListedCategory = includeInactive ? row : omitIsActive(row);
    size += JSON.stringify(listed).length + 1; // the comma between rows
    if (size > CATEGORY_TEXT_BUDGET) break;
    categories.push(listed);
  }
  return {
    count: matched.length,
    truncated: categories.length < matched.length,
    categories,
  };
}

function omitIsActive({ is_active: _active, ...rest }: CategoryRow): ListedCategory {
  return rest;
}

type LookupResult = { data: CategoryRow | null; error: { message: string } | null };
type LookupListResult = { data: CategoryRow[] | null; error: { message: string } | null };

/** A query that gives one row with maybeSingle(), or all rows when awaited. */
interface LookupQuery extends PromiseLike<LookupListResult> {
  eq(column: string, value: string | boolean): LookupQuery;
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
 * The active accounts of the restaurant whose name equals `name`, trimmed and
 * not case-sensitive. The compare runs here and not in an ilike pattern, so
 * `%` or `_` in the name is not a wildcard.
 */
async function findActiveByName(
  supabase: CategoryLookupClient,
  restaurantId: string,
  name: string,
): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from('chart_of_accounts')
    .select(CATEGORY_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true);
  // PostgREST max-rows (1000) can cut this list with no error. A chart of
  // accounts has far fewer rows (see the design's trade-offs).
  if (error) throw new Error(`Category lookup failed: ${error.message}`);
  const needle = name.toLowerCase();
  return (data ?? [])
    .filter((row) => row.account_name.trim().toLowerCase() === needle)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
}

/**
 * Finds a category of the restaurant by its id, its account code, or its
 * exact name, in that order.
 *
 * - The ref is trimmed. Its case is kept for the code, because the unique
 *   key (restaurant_id, account_code) is case-sensitive.
 * - A UUID is looked up as an id first, then as a code: account_code is free
 *   text, so a code can have the shape of a UUID.
 * - A name is used only when exactly one active account has it. Names are
 *   not unique, so two matches return an error with their codes.
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
    message: `Unknown category "${value}". Use a category id, account code, or exact name from list_categories.`,
  };
  if (!value) return notFound;

  let category: CategoryRow | null = null;
  if (UUID_PATTERN.test(value)) {
    category = await findBy(supabase, restaurantId, 'id', value);
  }
  category ??= await findBy(supabase, restaurantId, 'account_code', value);

  if (!category) {
    const byName = await findActiveByName(supabase, restaurantId, value);
    if (byName.length > 1) {
      return {
        ok: false,
        message: `Category name "${value}" matches ${byName.length} categories: ${byName
          .map((row) => row.account_code)
          .join(', ')}. Use the account code.`,
      };
    }
    category = byName[0] ?? null;
  }

  if (!category) return notFound;
  if (!category.is_active) {
    return {
      ok: false,
      message: `Category ${category.account_code} ${category.account_name} is inactive. Choose an active category.`,
    };
  }
  return { ok: true, category };
}
