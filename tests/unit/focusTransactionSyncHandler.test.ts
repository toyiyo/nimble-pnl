/**
 * focusTransactionSyncHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusTransactionSyncHandler.ts
 *
 * Coverage:
 *  - processDayTransactions: given mocked fetchDatafeed + mocked supabase client,
 *      - calls fetchDatafeed with the correct config (baseUrl, guid, apiKey, apiSecret)
 *      - calls fetchDatafeed with the correct business date (YYYY-MM-DD)
 *      - when fetchDatafeed returns ok:true, parses the XML with parseFocusDatafeed
 *      - upserts focus_orders (one per check)
 *      - upserts focus_order_items via ONE array upsert per check (skips isKitchenComment)
 *      - upserts focus_payments via ONE array upsert per check
 *      - calls sync_focus_transactions_to_unified_sales RPC for the restaurant + date
 *      - returns { status: 'ok', checksWritten: N } on success
 *      - returns { status: 'empty' } when checks array is empty
 *      - returns { status: 'inprogress' } when fetchDatafeed kind is 'inprogress'
 *      - returns { status: 'error', error: string } when fetchDatafeed returns ok:false (non-inprogress)
 *      - returns { status: 'error' } when supabase upsert fails
 *      - does NOT persist kitchen-comment items (isKitchenComment=true)
 *      - calls fetchDatafeed exactly once per call
 *      - calls the unified_sales RPC with correct p_restaurant_id and date params
 *      - when skipUnifiedSalesSync=true, does NOT call the RPC
 *  - processDateRangeTransactions: iterates explicit date list, calls processDayTransactions each day,
 *      calls unified_sales RPC once for the full range (unless skipUnifiedSalesSync).
 *
 * Design ref: plan Task B2; spec §4 (sync flow), §3 (data model), §8.4 (batch upserts).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  processDayTransactions,
  processDateRangeTransactions,
  type TransactionSyncDeps,
  type TransactionSyncConfig,
  type TransactionSupabaseDeps,
} from '../../supabase/functions/_shared/focusTransactionSyncHandler';
import { computeChecksFingerprint } from '../../supabase/functions/_shared/focusDatafeedFingerprint';

// Narrowed return type for the fetchDatafeed mock used in tests
type FetchDatafeedFn = TransactionSyncDeps['fetchDatafeed'];

// ── Sample XML (from fixtures; two checks, one with kitchen comments) ──────────

const SAMPLE_XML_EMPTY = '<DailyData><Checks></Checks></DailyData>';

const SAMPLE_XML_ONE_CHECK = `<DailyData><Checks><Check>
<CheckRecord><ID>10</ID><TimeOpened>06/29/2026 10:00:00</TimeOpened>
<TimeClosed>06/29/2026 10:05:00</TimeClosed><OrderTypeID>1</OrderTypeID>
<RevenueCenterID>1</RevenueCenterID><Guests>2</Guests><Total>12.50</Total>
<DiscountTotalAmount>0</DiscountTotalAmount><TaxableSales1>11.37</TaxableSales1>
</CheckRecord><Seats><Seat>
<SeatRecord><Key>5</Key></SeatRecord>
<CheckItemRecord>
  <SeatKey>5</SeatKey><Key>3</Key><RecordNumber>100</RecordNumber>
  <ID>Scoop</ID><GuestCheckName>Scoop Single</GuestCheckName>
  <ReportGroupID>10</ReportGroupID><Price>4.99</Price>
</CheckItemRecord>
<CheckItemRecord>
  <SeatKey>5</SeatKey><Key>4</Key><ItemKey>3</ItemKey>
  <RecordNumber>200</RecordNumber><ID>FlavChoc</ID>
  <GuestCheckName>Chocolate</GuestCheckName><ReportGroupID>20</ReportGroupID>
  <FlagsSub>Y</FlagsSub>
</CheckItemRecord>
<CheckItemRecord>
  <SeatKey>5</SeatKey><Key>2</Key><RecordNumber>999</RecordNumber>
  <ID>Kitchen Comment</ID><GuestCheckName>CUSTOMER NAME REDACTED</GuestCheckName>
  <ReportGroupID>45</ReportGroupID><FlagsKitchenComment>Y</FlagsKitchenComment>
</CheckItemRecord>
<PaymentRecord>
  <SeatKey>5</SeatKey><Key>1</Key><ID>5</ID>
  <Name>Visa</Name><Amount>12.50</Amount><Tip>1.50</Tip>
  <Account>XXXXXXXXXXXX1234</Account>
</PaymentRecord>
</Seat></Seats></Check></Checks></DailyData>`;

// ── Constants ─────────────────────────────────────────────────────────────────

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000099';
const STORE_ID = 'aabbccdd-0000-1111-2222-333344445555'; // restaurant GUID for Lynk
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const BUSINESS_DATE = '2026-06-29';

const MOCK_CONFIG: TransactionSyncConfig = {
  restaurantId: RESTAURANT_ID,
  storeId: STORE_ID,
  apiKey: API_KEY,
  apiSecret: API_SECRET,
  baseUrl: 'https://pos-api.focuspos.com',
};

// ── Mock builders ─────────────────────────────────────────────────────────────

function makeUpsertMock() {
  const selectFn = vi.fn().mockResolvedValue({ data: [], error: null });
  const upsertFn = vi.fn().mockReturnValue({ select: selectFn });
  return { upsertFn, selectFn };
}

function makeRpcMock() {
  return vi.fn().mockResolvedValue({ data: null, error: null });
}

function makeDeleteMock() {
  // Three-level eq chain: .delete().eq(restaurant_id).eq(business_date).eq(focus_check_id)
  const eqInnermost = vi.fn().mockResolvedValue({ error: null });
  const eqInner = vi.fn().mockReturnValue({ eq: eqInnermost });
  const eqOuter = vi.fn().mockReturnValue({ eq: eqInner });
  const deleteFn = vi.fn().mockReturnValue({ eq: eqOuter });
  return { deleteFn, eqOuter, eqInner, eqInnermost };
}

function makeSupabaseMock() {
  const { upsertFn: ordersUpsert, selectFn: ordersSelect } = makeUpsertMock();
  const { upsertFn: itemsUpsert, selectFn: itemsSelect } = makeUpsertMock();
  const { upsertFn: paymentsUpsert, selectFn: paymentsSelect } = makeUpsertMock();
  const { deleteFn: ordersDelete, eqOuter: deleteEqOuter, eqInner: deleteEqInner, eqInnermost: deleteEqInnermost } = makeDeleteMock();
  const rpcFn = makeRpcMock();

  const fromFn = vi.fn().mockImplementation((table: string) => {
    if (table === 'focus_orders') return { upsert: ordersUpsert, delete: ordersDelete };
    if (table === 'focus_order_items') return { upsert: itemsUpsert };
    if (table === 'focus_payments') return { upsert: paymentsUpsert };
    return { upsert: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }) };
  });

  return {
    client: { from: fromFn, rpc: rpcFn },
    mocks: { fromFn, ordersUpsert, ordersSelect, itemsUpsert, itemsSelect, paymentsUpsert, paymentsSelect, ordersDelete, deleteEqOuter, deleteEqInner, deleteEqInnermost, rpcFn },
  };
}

function makeFetchDatafeedMock(xml: string = SAMPLE_XML_ONE_CHECK) {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, xml });
}

function makeDeps(opts: {
  xml?: string;
  fetchDatafeedResult?: { ok: boolean; status: number; xml?: string; kind?: string; error?: string };
  upsertError?: { message: string } | null;
}): { deps: TransactionSyncDeps; mocks: ReturnType<typeof makeSupabaseMock>['mocks']; fetchDatafeedMock: ReturnType<typeof vi.fn> } {
  const { client, mocks } = makeSupabaseMock();

  if (opts.upsertError) {
    mocks.ordersUpsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: opts.upsertError }),
    });
  }

  const fetchDatafeedMock = opts.fetchDatafeedResult
    ? vi.fn().mockResolvedValue(opts.fetchDatafeedResult)
    : makeFetchDatafeedMock(opts.xml ?? SAMPLE_XML_ONE_CHECK);

  return {
    deps: {
      supabase: client as unknown as TransactionSupabaseDeps,
      fetchDatafeed: fetchDatafeedMock as unknown as FetchDatafeedFn,
    },
    mocks,
    fetchDatafeedMock,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processDayTransactions', () => {
  // ── fetchDatafeed call contract ───────────────────────────────────────────────

  it('calls fetchDatafeed with the correct baseUrl', async () => {
    const { deps, fetchDatafeedMock } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(fetchDatafeedMock).toHaveBeenCalledOnce();
    const call = fetchDatafeedMock.mock.calls[0];
    // second arg is the config
    expect(call[1]).toMatchObject({ baseUrl: MOCK_CONFIG.baseUrl });
  });

  it('calls fetchDatafeed with the correct restaurantGuid (storeId)', async () => {
    const { deps, fetchDatafeedMock } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const call = fetchDatafeedMock.mock.calls[0];
    expect(call[1]).toMatchObject({ restaurantGuid: MOCK_CONFIG.storeId });
  });

  it('calls fetchDatafeed with apiKey and apiSecret', async () => {
    const { deps, fetchDatafeedMock } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const call = fetchDatafeedMock.mock.calls[0];
    expect(call[1]).toMatchObject({ apiKey: MOCK_CONFIG.apiKey, apiSecret: MOCK_CONFIG.apiSecret });
  });

  it('calls fetchDatafeed with the correct businessDate string', async () => {
    const { deps, fetchDatafeedMock } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const call = fetchDatafeedMock.mock.calls[0];
    expect(call[2]).toBe(BUSINESS_DATE);
  });

  it('calls fetchDatafeed exactly once', async () => {
    const { deps, fetchDatafeedMock } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(fetchDatafeedMock).toHaveBeenCalledOnce();
  });

  // ── Success: focus_orders upsert ─────────────────────────────────────────────

  it('upserts one focus_orders row per check', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    // One check in SAMPLE_XML_ONE_CHECK
    expect(mocks.ordersUpsert).toHaveBeenCalledOnce();
    const row = mocks.ordersUpsert.mock.calls[0][0];
    expect(row).toMatchObject({
      restaurant_id: RESTAURANT_ID,
      business_date: BUSINESS_DATE,
      focus_check_id: '10',
    });
  });

  it('includes check totals in the focus_orders row', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const row = mocks.ordersUpsert.mock.calls[0][0];
    expect(row.total).toBe(12.50);
  });

  it('uses ON CONFLICT on the correct columns for focus_orders', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const upsertOptions = mocks.ordersUpsert.mock.calls[0][1];
    expect(upsertOptions?.onConflict).toMatch(/restaurant_id.*business_date.*focus_check_id/);
  });

  // ── Success: focus_order_items BATCH upsert (§8.4) ──────────────────────────
  // After B2, items are upserted as ONE array per check, not one await per row.

  it('makes exactly ONE focus_order_items upsert call per check (batch)', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    // SAMPLE_XML_ONE_CHECK has 1 check → 1 array upsert call
    expect(mocks.itemsUpsert).toHaveBeenCalledOnce();
  });

  it('upserts items as an array (not individual rows)', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    // First (only) call's first arg must be an array
    const arg = mocks.itemsUpsert.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it('skips kitchen-comment items (isKitchenComment=true)', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    // SAMPLE_XML_ONE_CHECK has: 1 priced item + 1 modifier + 1 kitchen comment
    // The array must have exactly 2 items (no kitchen comment)
    const itemsArray = mocks.itemsUpsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(itemsArray).toHaveLength(2);
    const itemNames = itemsArray.map((r) => r.name);
    expect(itemNames).not.toContain('CUSTOMER NAME REDACTED');
  });

  it('writes the priced item row to focus_order_items array', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const itemsArray = mocks.itemsUpsert.mock.calls[0][0] as Record<string, unknown>[];
    const scoop = itemsArray.find((r) => r.name === 'Scoop Single');
    expect(scoop).toBeTruthy();
    expect(scoop.price).toBe(4.99);
    expect(scoop.is_modifier).toBe(false);
    expect(scoop.report_group_id).toBe('10');
    expect(scoop.restaurant_id).toBe(RESTAURANT_ID);
    expect(scoop.business_date).toBe(BUSINESS_DATE);
  });

  it('writes the modifier row to focus_order_items array', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const itemsArray = mocks.itemsUpsert.mock.calls[0][0] as Record<string, unknown>[];
    const modifier = itemsArray.find((r) => r.name === 'Chocolate');
    expect(modifier).toBeTruthy();
    expect(modifier.is_modifier).toBe(true);
    expect(modifier.parent_key).toBe('3');
  });

  it('uses ON CONFLICT on the correct columns for focus_order_items', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const upsertOptions = mocks.itemsUpsert.mock.calls[0][1];
    expect(upsertOptions?.onConflict).toMatch(
      /restaurant_id.*business_date.*focus_check_id.*item_key/
    );
  });

  // ── Success: focus_payments BATCH upsert (§8.4) ─────────────────────────────
  // After B2, payments are upserted as ONE array per check.

  it('makes exactly ONE focus_payments upsert call per check (batch)', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(mocks.paymentsUpsert).toHaveBeenCalledOnce();
  });

  it('upserts payments as an array (not individual rows)', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const arg = mocks.paymentsUpsert.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
  });

  it('upserts one focus_payments row per payment per check (inside the array)', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const paymentsArray = mocks.paymentsUpsert.mock.calls[0][0] as Record<string, unknown>[];
    expect(paymentsArray).toHaveLength(1);
    expect(paymentsArray[0]).toMatchObject({
      restaurant_id: RESTAURANT_ID,
      business_date: BUSINESS_DATE,
      focus_check_id: '10',
      name: 'Visa',
      amount: 12.50,
      tip: 1.50,
      card_last4: '1234',
    });
  });

  it('uses ON CONFLICT on the correct columns for focus_payments', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const upsertOptions = mocks.paymentsUpsert.mock.calls[0][1];
    expect(upsertOptions?.onConflict).toMatch(
      /restaurant_id.*business_date.*focus_check_id.*payment_key/
    );
  });

  // ── Success: unified_sales RPC ───────────────────────────────────────────────

  it('calls sync_focus_transactions_to_unified_sales RPC with correct params', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(mocks.rpcFn).toHaveBeenCalledOnce();
    expect(mocks.rpcFn).toHaveBeenCalledWith(
      'sync_focus_transactions_to_unified_sales',
      expect.objectContaining({
        p_restaurant_id: RESTAURANT_ID,
        p_start_date: BUSINESS_DATE,
        p_end_date: BUSINESS_DATE,
      })
    );
  });

  it('does NOT call the RPC when skipUnifiedSalesSync=true', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE, { skipUnifiedSalesSync: true });
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  // ── Success result ────────────────────────────────────────────────────────────

  it('returns { status: "ok", checksWritten: 1 } for one check', async () => {
    const { deps } = makeDeps({});
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'ok', checksWritten: 1 });
  });

  // ── Empty datafeed ────────────────────────────────────────────────────────────

  it('returns { status: "empty" } when checks array is empty', async () => {
    const { deps } = makeDeps({ xml: SAMPLE_XML_EMPTY });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'empty' });
  });

  it('does NOT call upsert or RPC when datafeed is empty', async () => {
    const { deps, mocks } = makeDeps({ xml: SAMPLE_XML_EMPTY });
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(mocks.ordersUpsert).not.toHaveBeenCalled();
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  // ── InProgress response ───────────────────────────────────────────────────────

  it('returns { status: "inprogress" } when fetchDatafeed returns kind="inprogress"', async () => {
    const { deps } = makeDeps({
      fetchDatafeedResult: {
        ok: false,
        status: 200,
        kind: 'inprogress',
        error: 'InProgress',
      },
    });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'inprogress' });
  });

  // ── Network / HTTP error ─────────────────────────────────────────────────────

  it('returns { status: "error" } when fetchDatafeed returns ok:false (auth error)', async () => {
    const { deps } = makeDeps({
      fetchDatafeedResult: {
        ok: false,
        status: 401,
        kind: 'auth',
        error: '401 Unauthorized',
      },
    });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'error' });
    expect((result as { error?: string }).error).toBeTruthy();
  });

  it('returns { status: "error" } when fetchDatafeed returns ok:false (network error)', async () => {
    const { deps } = makeDeps({
      fetchDatafeedResult: {
        ok: false,
        status: 0,
        kind: 'network',
        error: 'fetch failed',
      },
    });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'error' });
  });

  // ── Supabase upsert error ────────────────────────────────────────────────────

  it('returns { status: "error" } when focus_orders upsert fails', async () => {
    const { deps } = makeDeps({
      upsertError: { message: 'DB write failed' },
    });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'error' });
    expect((result as { error?: string }).error).toMatch(/DB write failed/);
  });

  // ── Voided checks (DeleteRecord) ─────────────────────────────────────────────

  it('deletes voided checks from focus_orders when DeleteRecord entries are present', async () => {
    const XML_WITH_DELETE = `<DailyData><Checks>
<Check><CheckRecord><ID>10</ID><Total>12.50</Total></CheckRecord>
<Seats><Seat><SeatRecord><Key>1</Key></SeatRecord>
<CheckItemRecord><SeatKey>1</SeatKey><Key>3</Key><RecordNumber>100</RecordNumber>
  <ID>Scoop</ID><GuestCheckName>Scoop Single</GuestCheckName>
  <ReportGroupID>10</ReportGroupID><Price>4.99</Price>
</CheckItemRecord>
<PaymentRecord><SeatKey>1</SeatKey><Key>1</Key><ID>5</ID>
  <Name>Visa</Name><Amount>12.50</Amount></PaymentRecord>
</Seat></Seats></Check>
<DeleteRecord><ID>99</ID></DeleteRecord>
</Checks></DailyData>`;

    const { deps, mocks } = makeDeps({ xml: XML_WITH_DELETE });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);

    // Should succeed — the live check is processed normally
    expect(result).toMatchObject({ status: 'ok', checksWritten: 1 });

    // focus_orders.delete() scoped to restaurant_id + business_date + focus_check_id
    expect(mocks.ordersDelete).toHaveBeenCalledOnce();
    expect(mocks.deleteEqOuter).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID);
    expect(mocks.deleteEqInner).toHaveBeenCalledWith('business_date', BUSINESS_DATE);
    expect(mocks.deleteEqInnermost).toHaveBeenCalledWith('focus_check_id', '99');
  });

  it('returns ok when only voided checks are present (no active checks)', async () => {
    // A day where all checks were voided: checks.length === 0 but deletedCheckIds.length > 0
    const XML_ONLY_DELETE = `<DailyData><Checks>
<DeleteRecord><ID>55</ID></DeleteRecord>
</Checks></DailyData>`;

    const { deps, mocks } = makeDeps({ xml: XML_ONLY_DELETE });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);

    // Not 'empty' — there is work to do (delete the voided check)
    expect(result).toMatchObject({ status: 'ok', checksWritten: 0 });
    expect(mocks.ordersDelete).toHaveBeenCalledOnce();
    expect(mocks.ordersUpsert).not.toHaveBeenCalled();
  });

  // ── Multiple checks: batch calls per check (not per item) ────────────────────

  it('processes 2 checks and returns checksWritten=2', async () => {
    const TWO_CHECKS = `<DailyData><Checks>
<Check><CheckRecord><ID>1</ID><Total>5.00</Total></CheckRecord><Seats><Seat><SeatRecord><Key>1</Key></SeatRecord><CheckItemRecord><SeatKey>1</SeatKey><Key>10</Key><RecordNumber>1</RecordNumber><ID>Item1</ID><GuestCheckName>Item1</GuestCheckName><ReportGroupID>10</ReportGroupID><Price>5.00</Price></CheckItemRecord><PaymentRecord><SeatKey>1</SeatKey><Key>11</Key><ID>1</ID><Name>Cash</Name><Amount>5.00</Amount></PaymentRecord></Seat></Seats></Check>
<Check><CheckRecord><ID>2</ID><Total>3.00</Total></CheckRecord><Seats><Seat><SeatRecord><Key>2</Key></SeatRecord><CheckItemRecord><SeatKey>2</SeatKey><Key>20</Key><RecordNumber>2</RecordNumber><ID>Item2</ID><GuestCheckName>Item2</GuestCheckName><ReportGroupID>10</ReportGroupID><Price>3.00</Price></CheckItemRecord><PaymentRecord><SeatKey>2</SeatKey><Key>21</Key><ID>2</ID><Name>Card</Name><Amount>3.00</Amount></PaymentRecord></Seat></Seats></Check>
</Checks></DailyData>`;

    const { deps, mocks } = makeDeps({ xml: TWO_CHECKS });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'ok', checksWritten: 2 });
    expect(mocks.ordersUpsert).toHaveBeenCalledTimes(2);
    // ONE items upsert call per check (2 checks → 2 calls), each call is an array
    expect(mocks.itemsUpsert).toHaveBeenCalledTimes(2);
    expect(Array.isArray(mocks.itemsUpsert.mock.calls[0][0])).toBe(true);
    expect(Array.isArray(mocks.itemsUpsert.mock.calls[1][0])).toBe(true);
    // ONE payments upsert call per check (2 checks → 2 calls)
    expect(mocks.paymentsUpsert).toHaveBeenCalledTimes(2);
    expect(Array.isArray(mocks.paymentsUpsert.mock.calls[0][0])).toBe(true);
    expect(Array.isArray(mocks.paymentsUpsert.mock.calls[1][0])).toBe(true);
  });

  // ── Error from array upsert → check fails ────────────────────────────────────

  it('returns { status: "error" } when the items array upsert fails', async () => {
    const { client, mocks } = makeSupabaseMock();
    // Make items upsert fail
    mocks.itemsUpsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: 'items write failed' } }),
    });
    const fetchDatafeedMock = makeFetchDatafeedMock();
    const deps: TransactionSyncDeps = {
      supabase: client as unknown as TransactionSupabaseDeps,
      fetchDatafeed: fetchDatafeedMock as unknown as FetchDatafeedFn,
    };
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'error' });
    expect((result as { error?: string }).error).toMatch(/items write failed/);
  });

  it('returns { status: "error" } when the payments array upsert fails', async () => {
    const { client, mocks } = makeSupabaseMock();
    // Make payments upsert fail
    mocks.paymentsUpsert.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: { message: 'payments write failed' } }),
    });
    const fetchDatafeedMock = makeFetchDatafeedMock();
    const deps: TransactionSyncDeps = {
      supabase: client as unknown as TransactionSupabaseDeps,
      fetchDatafeed: fetchDatafeedMock as unknown as FetchDatafeedFn,
    };
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'error' });
    expect((result as { error?: string }).error).toMatch(/payments write failed/);
  });

  // ── Delta skip (optional stateStore dep) — Task 3 ────────────────────────────
  // The stateStore is opt-in: only present in these tests. Existing tests above
  // (deps without a stateStore) prove behavior is unchanged when it's absent.

  describe('delta skip (optional stateStore dep)', () => {
    const XML = '<DailyData><Checks><Check><CheckRecord><ID>10</ID><Total>12.50</Total></CheckRecord><Seats><Seat><SeatRecord><Key>5</Key></SeatRecord><CheckItemRecord><SeatKey>5</SeatKey><Key>3</Key><RecordNumber>100</RecordNumber><ID>Scoop</ID><GuestCheckName>Scoop Single</GuestCheckName><ReportGroupID>10</ReportGroupID><Price>4.99</Price></CheckItemRecord><PaymentRecord><SeatKey>5</SeatKey><Key>1</Key><ID>5</ID><Name>Visa</Name><Amount>12.50</Amount></PaymentRecord></Seat></Seats></Check></Checks></DailyData>';

    function makeStateStore(stored: { bytes: number; sha256: string; fetchedAt: string } | null) {
      return {
        get: vi.fn().mockResolvedValue(stored),
        touch: vi.fn().mockResolvedValue(undefined),
        record: vi.fn().mockResolvedValue(undefined),
      };
    }

    it('returns unchanged and skips ALL writes when the fingerprint matches', async () => {
      const fp = await computeChecksFingerprint(XML);
      const stateStore = makeStateStore({ ...fp, fetchedAt: '2026-07-04T10:00:00Z' });
      const { deps, mocks } = makeDeps({ xml: XML });

      const result = await processDayTransactions({ ...deps, stateStore }, MOCK_CONFIG, BUSINESS_DATE);

      expect(result).toEqual({ status: 'unchanged' });
      expect(mocks.ordersUpsert).not.toHaveBeenCalled();
      expect(mocks.itemsUpsert).not.toHaveBeenCalled();
      expect(mocks.paymentsUpsert).not.toHaveBeenCalled();
      expect(mocks.rpcFn).not.toHaveBeenCalled();
      expect(stateStore.touch).toHaveBeenCalledWith(RESTAURANT_ID, BUSINESS_DATE, fp);
      expect(stateStore.record).not.toHaveBeenCalled();
    });

    it('processes normally and records the fingerprint on mismatch', async () => {
      const stateStore = makeStateStore({ bytes: 1, sha256: '0'.repeat(64), fetchedAt: '2026-07-04T10:00:00Z' });
      const { deps, mocks } = makeDeps({ xml: XML });

      const result = await processDayTransactions({ ...deps, stateStore }, MOCK_CONFIG, BUSINESS_DATE);

      expect(result).toEqual({ status: 'ok', checksWritten: 1 });
      expect(mocks.ordersUpsert).toHaveBeenCalled();
      expect(stateStore.record).toHaveBeenCalledOnce();
      const [restaurantId, businessDate, fp] = stateStore.record.mock.calls[0];
      expect(restaurantId).toBe(RESTAURANT_ID);
      expect(businessDate).toBe(BUSINESS_DATE);
      expect(fp.bytes).toBeGreaterThan(0);
      expect(stateStore.touch).not.toHaveBeenCalled();
    });

    it('processes normally when no prior fingerprint exists (get returns null)', async () => {
      const stateStore = makeStateStore(null);
      const { deps } = makeDeps({ xml: XML });

      const result = await processDayTransactions({ ...deps, stateStore }, MOCK_CONFIG, BUSINESS_DATE);

      expect(result.status).toBe('ok');
      expect(stateStore.get).toHaveBeenCalledWith(RESTAURANT_ID, BUSINESS_DATE);
      expect(stateStore.record).toHaveBeenCalledOnce();
    });

    it('without a stateStore dep, behavior is exactly as before (no state calls, normal processing)', async () => {
      const { deps, mocks } = makeDeps({ xml: XML });

      const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);

      expect(result.status).toBe('ok');
      expect(mocks.ordersUpsert).toHaveBeenCalled();
    });

    it('returns unchanged (not empty) when an empty datafeed matches its prior empty-block fingerprint', async () => {
      // The delta-skip check runs before the parse/empty-check (step 2.5,
      // ahead of step 3), so a feed whose <Checks> block is empty both now
      // and previously matches on fingerprint and short-circuits to
      // 'unchanged' before the parser ever runs — same as any other match.
      const emptyFp = await computeChecksFingerprint(SAMPLE_XML_EMPTY);
      const stateStore = makeStateStore({ ...emptyFp, fetchedAt: '2026-07-04T10:00:00Z' });
      const { deps } = makeDeps({ xml: SAMPLE_XML_EMPTY });

      const result = await processDayTransactions({ ...deps, stateStore }, MOCK_CONFIG, BUSINESS_DATE);

      expect(result).toEqual({ status: 'unchanged' });
      expect(stateStore.touch).toHaveBeenCalledWith(RESTAURANT_ID, BUSINESS_DATE, emptyFp);
    });

    it('still returns empty when there is no prior state (first-ever pull of a quiet feed)', async () => {
      const stateStore = makeStateStore(null);
      const { deps } = makeDeps({ xml: SAMPLE_XML_EMPTY });

      const result = await processDayTransactions({ ...deps, stateStore }, MOCK_CONFIG, BUSINESS_DATE);

      // No prior fingerprint → not a delta-skip candidate → falls through to
      // the normal empty-datafeed path (no checks/deletes → 'empty'); no
      // fingerprint record for an empty feed (nothing was written).
      expect(result).toEqual({ status: 'empty' });
      expect(stateStore.record).not.toHaveBeenCalled();
    });
  });
});

// ── processDateRangeTransactions ──────────────────────────────────────────────

describe('processDateRangeTransactions', () => {
  /**
   * Build a deps object with a mocked processDayTransactions.
   *
   * NOTE: The range function no longer calls the unified_sales RPC at the end.
   * Aggregation is handled by the Postgres cron (focus-transactions-unified-sales-sync).
   * The supabase mock's rpcFn is still wired up so tests can assert it is NOT called.
   */
  function makeDateRangeDeps(opts: {
    dayResults?: Record<string, { status: 'ok' | 'empty' | 'error' | 'inprogress'; error?: string }>;
  } = {}) {
    const { client, mocks } = makeSupabaseMock();

    // processDateRangeTransactions calls deps.processDayTransactions for each date.
    // It does NOT call supabase.rpc — aggregation deferred to Postgres cron.
    const processDayMock = vi.fn().mockImplementation(
      async (_deps: unknown, _config: unknown, date: string) => {
        const overrides = opts.dayResults ?? {};
        return overrides[date] ?? { status: 'ok', checksWritten: 1 };
      },
    );

    return {
      deps: {
        supabase: client as unknown as TransactionSupabaseDeps,
        fetchDatafeed: vi.fn() as unknown as FetchDatafeedFn,
        processDayTransactions: processDayMock,
      },
      mocks,
      processDayMock,
    };
  }

  it('calls processDayTransactions once per date in the range', async () => {
    const { deps, processDayMock } = makeDateRangeDeps();
    await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-27', '2026-06-29');
    expect(processDayMock).toHaveBeenCalledTimes(3);
    const dates = processDayMock.mock.calls.map((c: unknown[]) => c[2]);
    expect(dates).toContain('2026-06-27');
    expect(dates).toContain('2026-06-28');
    expect(dates).toContain('2026-06-29');
  });

  it('calls processDayTransactions with skipUnifiedSalesSync=true for each day', async () => {
    const { deps, processDayMock } = makeDateRangeDeps();
    await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-27', '2026-06-29');
    for (const call of processDayMock.mock.calls) {
      expect(call[3]).toMatchObject({ skipUnifiedSalesSync: true });
    }
  });

  it('does NOT call the unified_sales RPC from the range path (aggregation deferred to Postgres cron)', async () => {
    // The in-worker RPC call was removed as part of the HTTP 546 CPU-limit fix.
    // The Postgres cron (focus-transactions-unified-sales-sync) handles
    // unified_sales aggregation asynchronously after the data lands in focus_orders.
    const { deps, mocks } = makeDateRangeDeps();
    await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-27', '2026-06-29');
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('does NOT call the RPC even when skipUnifiedSalesSync=false (range always skips it)', async () => {
    // skipUnifiedSalesSync is accepted for API compatibility but unused in the range path.
    const { deps, mocks } = makeDateRangeDeps();
    await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-27', '2026-06-29', { skipUnifiedSalesSync: false });
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('works for a single-day range', async () => {
    const { deps, processDayMock, mocks } = makeDateRangeDeps();
    const result = await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-29', '2026-06-29');
    expect(processDayMock).toHaveBeenCalledOnce();
    expect(processDayMock.mock.calls[0][2]).toBe('2026-06-29');
    // No RPC call even for a single day
    expect(mocks.rpcFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'ok', daysSynced: 1 });
  });

  it('returns { status, daysSynced } with count of processed days', async () => {
    const { deps } = makeDateRangeDeps();
    const result = await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-27', '2026-06-29');
    expect(result).toMatchObject({ status: 'ok', daysSynced: 3 });
  });

  it('stops on a day error and returns { status: "error" } without calling the RPC', async () => {
    const { deps, processDayMock, mocks } = makeDateRangeDeps({
      dayResults: {
        '2026-06-28': { status: 'error', error: 'datafeed error' },
      },
    });
    const result = await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-27', '2026-06-29');
    // Processes 06-27 (ok), then 06-28 (error → stops)
    expect(processDayMock.mock.calls.length).toBeLessThan(3);
    expect(result).toMatchObject({ status: 'error' });
    // RPC is never called from the range path regardless of outcome.
    expect(mocks.rpcFn).not.toHaveBeenCalled();
  });

  it('does not skip any date when all days are ok', async () => {
    const { deps, processDayMock } = makeDateRangeDeps();
    await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-25', '2026-06-29');
    expect(processDayMock).toHaveBeenCalledTimes(5);
    const dates = processDayMock.mock.calls.map((c: unknown[]) => c[2]).sort();
    expect(dates).toEqual(['2026-06-25', '2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29']);
  });

  it('calls processDayTransactions with the correct config', async () => {
    const { deps, processDayMock } = makeDateRangeDeps();
    await processDateRangeTransactions(deps, MOCK_CONFIG, '2026-06-29', '2026-06-29');
    expect(processDayMock.mock.calls[0][1]).toMatchObject({
      restaurantId: RESTAURANT_ID,
      storeId: STORE_ID,
    });
  });
});
