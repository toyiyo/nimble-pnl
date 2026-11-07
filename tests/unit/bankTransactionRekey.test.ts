import { describe, it, expect } from 'vitest';
import {
  BANK_ROW_MATCH_SELECT,
  MAX_REKEYS_PER_RUN,
  rowKey,
  tombstoneKey,
  planTransactionStore,
  type StripeTxn,
  type BankRowMatch,
  type TombstoneMatch,
} from '../../supabase/functions/_shared/bankTransactionRekey';

const T0 = 1_760_000_000;
const txn = (id: string, o: Partial<StripeTxn> = {}): StripeTxn => ({
  id,
  account: 'fca_1',
  transacted_at: T0,
  amount: -1250,
  description: 'Sysco Foods',
  ...o,
});
const row = (id: string, sid: string, o: Partial<BankRowMatch> = {}): BankRowMatch => ({
  id,
  stripe_transaction_id: sid,
  status: null,
  created_at: '2026-01-01T00:00:00Z',
  ta: String(T0),
  amt: '-1250',
  descr: 'Sysco Foods',
  acct: null,
  ...o,
});
const tomb = (id: string, ext: string | null, o: Partial<TombstoneMatch> = {}): TombstoneMatch => ({
  id,
  external_transaction_id: ext,
  transaction_date: new Date(T0 * 1000).toISOString().slice(0, 10),
  amount: -12.5,
  description: 'Sysco Foods',
  source: 'bank_integration',
  connected_bank_id: 'bank1',
  ...o,
});
const plan = (txns: StripeTxn[], rows: BankRowMatch[] = [], tombstones: TombstoneMatch[] = []) =>
  planTransactionStore({ txns, rows, tombstones, bankId: 'bank1' });

describe('constants', () => {
  it('has the expected select projection', () => {
    expect(BANK_ROW_MATCH_SELECT).toBe(
      'id, stripe_transaction_id, status, created_at, ta:raw_data->>transacted_at, amt:raw_data->>amount, descr:raw_data->>description, acct:raw_data->>account',
    );
    expect(MAX_REKEYS_PER_RUN).toBe(500);
  });
});

describe('rowKey', () => {
  it('matches text and number forms', () => {
    expect(rowKey(String(T0), '-1250', 'a')).toBe(rowKey(T0, -1250, 'a'));
  });
  it('returns null with no raw_data', () => {
    expect(rowKey(null, null, null)).toBeNull();
    expect(rowKey('x', '1', 'a')).toBeNull();
  });
  it('matches a null description with a null description', () => {
    expect(rowKey(T0, 1, null)).toBe(rowKey(T0, 1, undefined));
  });
});

describe('tombstoneKey', () => {
  it('uses the UTC date, cents, and normalized description', () => {
    const t = tomb('t1', 'fctxn_old', { description: '  Sysco, Foods! #1 ' });
    expect(tombstoneKey(t.transaction_date, t.amount, t.description)).toBe(
      tombstoneKey(new Date(T0 * 1000).toISOString(), -12.5, 'sysco foods 1'),
    );
  });
  it('keys a 23:30Z instant on the UTC date', () => {
    const ts = Date.UTC(2026, 0, 5, 23, 30) / 1000;
    const k = JSON.parse(tombstoneKey(new Date(ts * 1000).toISOString(), -1, 'a')!);
    expect(k[0]).toBe('2026-01-05');
  });
  it('returns null for a bad date', () => {
    expect(tombstoneKey(null, 1, 'a')).toBeNull();
    expect(tombstoneKey('2026-01-01', Number.NaN, 'a')).toBeNull();
  });
});

describe('planTransactionStore: section 3.1 table', () => {
  it('1 orphan, 1 new: 1 rekey', () => {
    const d = plan([txn('fctxn_new')], [row('r1', 'fctxn_old')]);
    expect(d).toEqual([
      { kind: 'rekey_row', txn: txn('fctxn_new'), rowId: 'r1', previousStripeId: 'fctxn_old', previousStatus: null },
    ]);
  });
  it('passes the row status to the rekey decision', () => {
    const d = plan([txn('n1')], [row('r1', 'fctxn_o1', { status: 'reconciled' })]);
    expect(d[0]).toMatchObject({ kind: 'rekey_row', previousStatus: 'reconciled' });
  });
  it('2 orphans, 2 new: 2 rekeys', () => {
    const d = plan(
      [txn('n1'), txn('n2')],
      [row('r1', 'fctxn_o1'), row('r2', 'fctxn_o2')],
    );
    expect(d).toMatchObject([
      { kind: 'rekey_row', txn: txn('n1'), rowId: 'r1', previousStripeId: 'fctxn_o1' },
      { kind: 'rekey_row', txn: txn('n2'), rowId: 'r2', previousStripeId: 'fctxn_o2' },
    ]);
  });
  it('1 orphan, 2 new: 1 rekey, 1 insert', () => {
    const d = plan([txn('n1'), txn('n2')], [row('r1', 'fctxn_o1')]);
    expect(d.map((x) => x.kind)).toEqual(['rekey_row', 'insert']);
  });
  it('2 orphans, 1 new: 1 rekey, orphan stays', () => {
    const d = plan([txn('n1')], [row('r1', 'fctxn_o1'), row('r2', 'fctxn_o2')]);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe('rekey_row');
  });
  it('0 orphans, 1 new: insert', () => {
    expect(plan([txn('n1')]).map((x) => x.kind)).toEqual(['insert']);
  });
});

describe('planTransactionStore: rules', () => {
  it('keeps two real identical transactions and inserts a third', () => {
    const d = plan(
      [txn('a'), txn('b'), txn('c')],
      [row('r1', 'a'), row('r2', 'b')],
    );
    expect(d.map((x) => x.kind)).toEqual(['skip_existing', 'skip_existing', 'insert']);
  });
  it('handles fca_ rotation', () => {
    const d = plan([txn('n1', { account: 'fca_2' })], [row('r1', 'fctxn_o1')]);
    expect(d[0].kind).toBe('rekey_row');
  });
  it('never matches a row with no raw_data', () => {
    const d = plan([txn('n1')], [row('r1', 'fctxn_o1', { ta: null, amt: null, descr: null })]);
    expect(d[0].kind).toBe('insert');
  });
  it('never matches a csv_ row', () => {
    const d = plan([txn('n1')], [row('r1', 'csv_abc', { ta: null, amt: null, descr: null })]);
    expect(d[0].kind).toBe('insert');
  });
  it('never matches an imported row with Stripe-shaped raw_data', () => {
    const d = plan([txn('n1'), txn('n2')], [row('r1', 'csv_abc'), row('r2', 'manual_abc')]);
    expect(d.map((x) => x.kind)).toEqual(['insert', 'insert']);
  });
  it('does not match a row of a different live account', () => {
    const d = plan(
      [txn('n1', { account: 'fca_1' }), txn('n2', { account: 'fca_2', amount: -1 })],
      [row('r1', 'fctxn_o1', { acct: 'fca_2' })],
    );
    expect(d.map((x) => x.kind)).toEqual(['insert', 'insert']);
  });
  it('matches a row of the same account', () => {
    const d = plan([txn('n1')], [row('r1', 'fctxn_o1', { acct: 'fca_1' })]);
    expect(d[0].kind).toBe('rekey_row');
  });
  it('matches a row of an account that is not live', () => {
    const d = plan([txn('n1')], [row('r1', 'fctxn_o1', { acct: 'fca_rotated' })]);
    expect(d[0].kind).toBe('rekey_row');
  });
  it('passes over a live-account row to a row of the same account', () => {
    const d = plan(
      [txn('n1', { account: 'fca_1' }), txn('n2', { account: 'fca_2', amount: -1 })],
      [row('r1', 'fctxn_o1', { acct: 'fca_2' }), row('r2', 'fctxn_o2', { acct: 'fca_1' })],
    );
    expect(d[0]).toMatchObject({ kind: 'rekey_row', rowId: 'r2' });
  });
  it('matches a zero amount and an epoch timestamp on a row', () => {
    const t = { transacted_at: 0, amount: 0 };
    expect(rowKey('0', '0', 'Sysco Foods')).not.toBeNull();
    const d = plan([txn('n1', t)], [row('r1', 'fctxn_o1', { ta: '0', amt: '0' })]);
    expect(d[0].kind).toBe('rekey_row');
  });
  it('matches a zero amount and an epoch timestamp on a tombstone', () => {
    const t = { transacted_at: 0, amount: 0 };
    expect(tombstoneKey('1970-01-01', 0, 'Sysco Foods')).not.toBeNull();
    const d = plan(
      [txn('fctxn_a', t)],
      [],
      [tomb('t1', 'fctxn_old', { transaction_date: '1970-01-01', amount: 0 })],
    );
    expect(d[0].kind).toBe('rekey_tombstone');
  });
  it('matches a null description with a null description', () => {
    const d = plan(
      [txn('n1', { description: null })],
      [row('r1', 'fctxn_o1', { descr: null })],
    );
    expect(d[0].kind).toBe('rekey_row');
  });
  it('uses the oldest orphan first', () => {
    const d = plan(
      [txn('n1')],
      [
        row('r2', 'fctxn_o2', { created_at: '2026-02-01T00:00:00Z' }),
        row('r1', 'fctxn_o1', { created_at: '2026-01-01T00:00:00Z' }),
      ],
    );
    expect(d[0]).toMatchObject({ rowId: 'r1', previousStripeId: 'fctxn_o1' });
  });
  it('breaks a created_at tie by id', () => {
    const d = plan([txn('n1')], [row('rb', 'fctxn_ob'), row('ra', 'fctxn_oa')]);
    expect(d[0]).toMatchObject({ rowId: 'ra' });
  });
  it('does not match when the key differs', () => {
    const d = plan([txn('n1', { amount: -999 })], [row('r1', 'fctxn_o1')]);
    expect(d[0].kind).toBe('insert');
  });
});

describe('planTransactionStore: tombstones', () => {
  it('skips an ID hit', () => {
    const d = plan([txn('fctxn_x')], [], [tomb('t1', 'fctxn_x')]);
    expect(d[0].kind).toBe('skip_tombstoned');
  });
  it('rekeys a reissued ID', () => {
    const d = plan([txn('fctxn_new')], [], [tomb('t1', 'fctxn_old')]);
    expect(d[0]).toEqual({
      kind: 'rekey_tombstone',
      txn: txn('fctxn_new'),
      tombstoneId: 't1',
      previousExternalId: 'fctxn_old',
    });
  });
  it('limits one tombstone to one transaction', () => {
    const d = plan([txn('fctxn_a'), txn('fctxn_b')], [], [tomb('t1', 'fctxn_old')]);
    expect(d.map((x) => x.kind)).toEqual(['rekey_tombstone', 'insert']);
  });
  it('ignores a tombstone of another bank', () => {
    const d = plan([txn('fctxn_a')], [], [tomb('t1', 'fctxn_old', { connected_bank_id: 'other' })]);
    expect(d[0].kind).toBe('insert');
  });
  it('ignores a non-fctxn_ ID', () => {
    const d = plan([txn('fctxn_a')], [], [tomb('t1', 'csv_old')]);
    expect(d[0].kind).toBe('insert');
  });
  it('ignores a null ID and a non-bank source', () => {
    const d = plan(
      [txn('fctxn_a')],
      [],
      [tomb('t1', null), tomb('t2', 'fctxn_o', { source: 'manual' })],
    );
    expect(d[0].kind).toBe('insert');
  });
  it('ignores a tombstone whose ID is in the Stripe list', () => {
    const d = plan([txn('fctxn_a'), txn('fctxn_b')], [], [tomb('t1', 'fctxn_a')]);
    expect(d.map((x) => x.kind)).toEqual(['skip_tombstoned', 'insert']);
  });
  it('matches a normalized description', () => {
    const d = plan(
      [txn('fctxn_a', { description: 'SYSCO  Foods!' })],
      [],
      [tomb('t1', 'fctxn_old', { description: 'sysco  foods' })],
    );
    expect(d[0].kind).toBe('rekey_tombstone');
  });
  it('uses the row match before the tombstone match', () => {
    const d = plan([txn('fctxn_a')], [row('r1', 'fctxn_o')], [tomb('t1', 'fctxn_old')]);
    expect(d[0].kind).toBe('rekey_row');
  });
  it('skips an existing row before a tombstone', () => {
    const d = plan([txn('a')], [row('r1', 'a')], [tomb('t1', 'a')]);
    expect(d[0].kind).toBe('skip_existing');
  });
});

describe('planTransactionStore: limit', () => {
  const many = (n: number) => {
    const txns: StripeTxn[] = [];
    const rows: BankRowMatch[] = [];
    for (let i = 0; i < n; i++) {
      txns.push(txn(`n${i}`, { amount: -i - 1 }));
      rows.push(row(`r${i}`, `fctxn_o${i}`, { amt: String(-i - 1) }));
    }
    return { txns, rows };
  };
  it('defers match 501, does not insert', () => {
    const { txns, rows } = many(MAX_REKEYS_PER_RUN + 1);
    const d = plan(txns, rows);
    expect(d.filter((x) => x.kind === 'rekey_row')).toHaveLength(MAX_REKEYS_PER_RUN);
    expect(d[MAX_REKEYS_PER_RUN].kind).toBe('defer_rekey');
    expect(d.some((x) => x.kind === 'insert')).toBe(false);
  });
  it('holds one orphan for one deferred match and inserts the next', () => {
    const { txns, rows } = many(MAX_REKEYS_PER_RUN);
    const d = plan(
      [...txns, txn('same1', { description: 'Other' }), txn('same2', { description: 'Other' })],
      [...rows, row('rx', 'fctxn_ox', { descr: 'Other' })],
    );
    expect(d.slice(-2).map((x) => x.kind)).toEqual(['defer_rekey', 'insert']);
  });
  it('shares the limit between row and tombstone rekeys', () => {
    const { txns, rows } = many(MAX_REKEYS_PER_RUN);
    const extra = txn('fctxn_extra', { description: 'Other' });
    const d = plan([...txns, extra], rows, [tomb('t1', 'fctxn_old', { description: 'Other' })]);
    expect(d[MAX_REKEYS_PER_RUN].kind).toBe('defer_rekey');
  });
});
