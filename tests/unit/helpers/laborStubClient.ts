/**
 * A stub of the Supabase query client for the shared labor loaders.
 *
 * - Each `from(table)` call starts a query record. The record keeps the
 *   select, the filters, the `or` filter (the keyset cursor), the order and
 *   the range, so a test can check what each query asked for.
 * - A table is served from a fixed row list. The stub applies the simple
 *   filters on flat columns (eq, in, gte, lte, lt), the keyset `or` filter,
 *   the order and the range, so the loader's page loop runs as it does
 *   against PostgREST. A filter on a dotted (embedded) column is recorded,
 *   not applied.
 * - A table can instead have a function that returns the page for a record.
 */
export type Row = Record<string, unknown>;

export interface QueryRecord {
  table: string;
  select: string | null;
  filters: Array<{ op: string; column: string; value: unknown }>;
  or: string | null;
  orders: Array<[string, unknown]>;
  range: [number, number] | null;
  single: boolean;
}

export type TableSource = Row[] | ((record: QueryRecord) => Row[]);

const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T/;

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const as = String(a);
  const bs = String(b);
  if (ISO_TS_RE.test(as) && ISO_TS_RE.test(bs)) {
    return new Date(as).getTime() - new Date(bs).getTime();
  }
  return as < bs ? -1 : as > bs ? 1 : 0;
}

const KEYSET_RE = /^(\w+)\.gt\."(.*)",and\(\1\.eq\."(.*)",id\.gt\."(.*)"\)$/;

function applyRecord(rows: Row[], record: QueryRecord): Row[] {
  let out = rows.filter((row) =>
    record.filters.every(({ op, column, value }) => {
      if (column.includes('.')) return true;
      const v = row[column];
      switch (op) {
        case 'eq':
          return v === value;
        case 'in':
          return (value as unknown[]).includes(v);
        case 'gte':
          return compareValues(v, value) >= 0;
        case 'lte':
          return compareValues(v, value) <= 0;
        case 'lt':
          return compareValues(v, value) < 0;
        default:
          return true;
      }
    }),
  );
  if (record.or) {
    const match = KEYSET_RE.exec(record.or);
    if (!match) throw new Error(`stub: unknown or() filter ${record.or}`);
    const [, column, key, , id] = match;
    out = out.filter((row) => {
      const c = compareValues(row[column], key);
      return c > 0 || (c === 0 && String(row.id) > id);
    });
  }
  const orders = record.orders.filter(
    ([, options]) => !(options && typeof options === 'object' && 'referencedTable' in options),
  );
  out = [...out].sort((a, b) => {
    for (const [column, options] of orders) {
      const desc = options && typeof options === 'object' && (options as { ascending?: boolean }).ascending === false;
      const c = compareValues(a[column], b[column]);
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
  if (record.range) out = out.slice(record.range[0], record.range[1] + 1);
  return out;
}

export interface StubClient {
  from(table: string): unknown;
  records: QueryRecord[];
  /** The records of one table, in call order. */
  recordsFor(table: string): QueryRecord[];
}

export function makeLaborStubClient(
  tables: Record<string, TableSource>,
  opts: { errorFor?: (record: QueryRecord) => unknown } = {},
): StubClient {
  const records: QueryRecord[] = [];

  const serve = (record: QueryRecord): Row[] => {
    const source = tables[record.table] ?? [];
    return typeof source === 'function' ? source(record) : applyRecord(source, record);
  };

  function from(table: string) {
    const record: QueryRecord = {
      table,
      select: null,
      filters: [],
      or: null,
      orders: [],
      range: null,
      single: false,
    };
    records.push(record);
    const resolve = () => {
      const error = opts.errorFor?.(record) ?? null;
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: serve(record), error: null });
    };
    const chain: Record<string, unknown> = {};
    const filter = (op: string) => (column: string, value: unknown) => {
      record.filters.push({ op, column, value });
      return chain;
    };
    chain.select = (columns: string) => {
      record.select = columns;
      return chain;
    };
    chain.eq = filter('eq');
    chain.in = filter('in');
    chain.gte = filter('gte');
    chain.lte = filter('lte');
    chain.lt = filter('lt');
    chain.or = (filters: string) => {
      record.or = filters;
      return chain;
    };
    chain.order = (column: string, options?: unknown) => {
      record.orders.push([column, options]);
      return chain;
    };
    chain.range = (fromIndex: number, toIndex: number) => {
      record.range = [fromIndex, toIndex];
      return resolve();
    };
    chain.maybeSingle = () => {
      record.single = true;
      const error = opts.errorFor?.(record) ?? null;
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({ data: serve(record)[0] ?? null, error: null });
    };
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      resolve().then(onFulfilled, onRejected);
    return chain;
  }

  return {
    from,
    records,
    recordsFor: (table: string) => records.filter((r) => r.table === table),
  };
}

/** The value of the first filter `op` on `column` in a record. */
export function filterValue(record: QueryRecord, op: string, column: string): unknown {
  return record.filters.find((f) => f.op === op && f.column === column)?.value;
}
