import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_TYPES,
  CATEGORY_LIST_CAP,
  filterCategories,
  isAccountType,
  normalizeAccountType,
  resolveCategoryRef,
  type CategoryLookupClient,
  type CategoryRow,
} from '../../supabase/functions/_shared/categoryLookup.ts';

const RESTAURANT = 'r-1';
const UUID = '0b8e3c1a-5f2d-4a6b-9c7e-1d2f3a4b5c6d';

function row(overrides: Partial<CategoryRow> = {}): CategoryRow {
  return {
    id: UUID,
    account_code: '2600-1',
    account_name: 'Tenant Improvement Allowance',
    account_type: 'liability',
    account_subtype: 'other_current_liabilities',
    parent_account_id: null,
    is_active: true,
    ...overrides,
  };
}

type Result = { data: CategoryRow | null; error: { message: string } | null };

/**
 * A fake client that records each query. The results map takes each
 * "column=value" key to a result; a missing key returns no row.
 */
function fakeClient(results: Record<string, Result>) {
  const queries: Array<Record<string, string>> = [];
  const client: CategoryLookupClient = {
    from(table) {
      expect(table).toBe('chart_of_accounts');
      const filters: Record<string, string> = {};
      const builder = {
        select() {
          return builder;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        maybeSingle() {
          queries.push({ ...filters });
          const key = 'id' in filters ? `id=${filters.id}` : `account_code=${filters.account_code}`;
          return Promise.resolve(results[key] ?? { data: null, error: null });
        },
      };
      return builder;
    },
  };
  return { client, queries };
}

describe('filterCategories', () => {
  const rows = [
    row({ id: 'a', account_code: '1000', account_name: 'Cash' }),
    row({ id: 'b', account_code: '2600-1', account_name: 'Tenant Improvement Allowance' }),
    row({ id: 'c', account_code: '4000', account_name: 'Food Sales' }),
  ];

  it('returns every row when search is empty', () => {
    const result = filterCategories(rows, '  ');
    expect(result.categories.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({ count: 3, truncated: false });
  });

  it('matches the code or the name with no case', () => {
    expect(filterCategories(rows, '2600').categories.map((c) => c.id)).toEqual(['b']);
    expect(filterCategories(rows, 'tenant').categories.map((c) => c.id)).toEqual(['b']);
    expect(filterCategories(rows, 'SALES').categories.map((c) => c.id)).toEqual(['c']);
  });

  it('puts count and truncated before the list, so a cut result keeps them', () => {
    expect(Object.keys(filterCategories(rows, undefined))).toEqual(['count', 'truncated', 'categories']);
  });

  it('leaves out is_active unless inactive rows were asked for', () => {
    expect(filterCategories(rows, undefined).categories[0]).not.toHaveProperty('is_active');
    expect(filterCategories(rows, undefined, { includeInactive: true }).categories[0]).toHaveProperty('is_active', true);
  });

  it('stops before the text budget when names are long, and marks the result truncated', () => {
    const long = Array.from({ length: CATEGORY_LIST_CAP }, (_, i) =>
      row({ id: `${UUID}-${i}`, account_code: `9999-${i}`, account_name: 'N'.repeat(200), parent_account_id: UUID }),
    );
    const result = filterCategories(long, undefined, { includeInactive: true });
    const envelope = JSON.stringify({ ok: true, data: result, evidence: [{ table: 'chart_of_accounts', summary: 'x'.repeat(80) }] });
    expect(envelope.length).toBeLessThan(40_000);
    expect(result.categories.length).toBeLessThan(CATEGORY_LIST_CAP);
    expect(result).toMatchObject({ count: CATEGORY_LIST_CAP, truncated: true });
  });

  it('caps the list so it fits the connector text limit (40,000 chars)', () => {
    const many = Array.from({ length: CATEGORY_LIST_CAP }, (_, i) =>
      row({
        id: `0b8e3c1a-5f2d-4a6b-9c7e-${String(i).padStart(12, '0')}`,
        account_code: `9999-${i}`,
        account_name: 'Long Category Name For A Size Check',
        parent_account_id: UUID,
      }),
    );
    expect(JSON.stringify(filterCategories(many, undefined)).length).toBeLessThan(40_000);
  });

  it('keeps the first rows up to the cap and marks the result truncated', () => {
    const many = Array.from({ length: CATEGORY_LIST_CAP + 2 }, (_, i) =>
      row({ id: `r${i}`, account_code: String(1000 + i) }),
    );
    const result = filterCategories(many, undefined);
    expect(result.categories).toHaveLength(CATEGORY_LIST_CAP);
    expect(result).toMatchObject({ count: CATEGORY_LIST_CAP + 2, truncated: true });
  });
});

describe('resolveCategoryRef', () => {
  it('finds a UUID by id, in the restaurant', async () => {
    const { client, queries } = fakeClient({ [`id=${UUID}`]: { data: row(), error: null } });
    const result = await resolveCategoryRef(client, RESTAURANT, UUID);
    expect(result).toEqual({ ok: true, category: row() });
    expect(queries).toEqual([{ restaurant_id: RESTAURANT, id: UUID }]);
  });

  it('finds an account code, trimmed, with its case kept', async () => {
    const { client, queries } = fakeClient({ 'account_code=Bar-A1': { data: row({ account_code: 'Bar-A1' }), error: null } });
    const result = await resolveCategoryRef(client, RESTAURANT, '  Bar-A1 ');
    expect(result.ok).toBe(true);
    expect(queries).toEqual([{ restaurant_id: RESTAURANT, account_code: 'Bar-A1' }]);
  });

  it('falls back to the account code when a UUID matches no id', async () => {
    const coded = row({ id: 'other', account_code: UUID });
    const { client, queries } = fakeClient({ [`account_code=${UUID}`]: { data: coded, error: null } });
    const result = await resolveCategoryRef(client, RESTAURANT, UUID);
    expect(result).toEqual({ ok: true, category: coded });
    expect(queries).toEqual([
      { restaurant_id: RESTAURANT, id: UUID },
      { restaurant_id: RESTAURANT, account_code: UUID },
    ]);
  });

  it('returns not found for an unknown or blank ref', async () => {
    const { client } = fakeClient({});
    expect(await resolveCategoryRef(client, RESTAURANT, '9999')).toEqual({
      ok: false,
      message: 'Unknown category "9999". Use a category id or an account code from list_categories.',
    });
    expect(await resolveCategoryRef(client, RESTAURANT, '   ')).toMatchObject({ ok: false });
    expect(await resolveCategoryRef(client, RESTAURANT, undefined)).toMatchObject({ ok: false });
  });

  it('refuses an inactive account and names it', async () => {
    const { client } = fakeClient({ 'account_code=2600-1': { data: row({ is_active: false }), error: null } });
    expect(await resolveCategoryRef(client, RESTAURANT, '2600-1')).toEqual({
      ok: false,
      message: 'Category 2600-1 Tenant Improvement Allowance is inactive. Choose an active category.',
    });
  });

  it('throws a database error instead of calling it not found', async () => {
    const { client } = fakeClient({ 'account_code=2600-1': { data: null, error: { message: 'boom' } } });
    await expect(resolveCategoryRef(client, RESTAURANT, '2600-1')).rejects.toThrow('boom');
  });
});

describe('isAccountType', () => {
  it('accepts the six enum values only, with their exact spelling', () => {
    expect(ACCOUNT_TYPES).toEqual(['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs']);
    for (const type of ACCOUNT_TYPES) expect(isAccountType(type)).toBe(true);
    for (const bad of ['Expense', 'cogs ', '', 'income', 3, null]) expect(isAccountType(bad)).toBe(false);
  });

  it('normalizes the case and the spaces of a model value', () => {
    expect(normalizeAccountType(' Expense ')).toBe('expense');
    expect(normalizeAccountType('COGS')).toBe('cogs');
    expect(normalizeAccountType('income')).toBe('income');
    expect(normalizeAccountType(3)).toBe(3);
  });
});
