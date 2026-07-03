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
 *      - upserts focus_order_items (skips isKitchenComment lines; includes priced + modifier lines)
 *      - upserts focus_payments (one per payment per check)
 *      - calls sync_focus_transactions_to_unified_sales RPC for the restaurant + date
 *      - returns { status: 'ok', checksWritten: N } on success
 *      - returns { status: 'empty' } when checks array is empty
 *      - returns { status: 'inprogress' } when fetchDatafeed kind is 'inprogress'
 *      - returns { status: 'error', error: string } when fetchDatafeed returns ok:false (non-inprogress)
 *      - returns { status: 'ok', checksWritten: 0 } when per-check upsert fails (per-check isolation)
 *      - does NOT persist kitchen-comment items (isKitchenComment=true)
 *      - calls fetchDatafeed exactly once per call
 *      - calls the unified_sales RPC with correct p_restaurant_id and date params
 *      - when skipUnifiedSalesSync=true, does NOT call the RPC
 *
 * Design ref: plan Task 4; spec §4 (sync flow), §3 (data model), §7 (testing).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  processDayTransactions,
  type TransactionSyncDeps,
  type TransactionSyncConfig,
} from '../../supabase/functions/_shared/focusTransactionSyncHandler';

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
      supabase: client as any,
      fetchDatafeed: fetchDatafeedMock as any,
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

  // ── Success: focus_order_items upsert ────────────────────────────────────────

  it('CRITICAL: skips kitchen-comment items (isKitchenComment=true) — PII compliance', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    // SAMPLE_XML_ONE_CHECK has: 1 priced item + 1 modifier + 1 kitchen comment
    // Only 2 should be written (no kitchen comment)
    expect(mocks.itemsUpsert).toHaveBeenCalledTimes(2);
    const itemNames = mocks.itemsUpsert.mock.calls.map(
      (c: any[]) => c[0].name
    );
    expect(itemNames).not.toContain('CUSTOMER NAME REDACTED');
  });

  it('writes the priced item row to focus_order_items', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const rows = mocks.itemsUpsert.mock.calls.map((c: any[]) => c[0]);
    const scoop = rows.find((r: any) => r.name === 'Scoop Single');
    expect(scoop).toBeTruthy();
    expect(scoop.price).toBe(4.99);
    expect(scoop.is_modifier).toBe(false);
    expect(scoop.report_group_id).toBe('10');
    expect(scoop.restaurant_id).toBe(RESTAURANT_ID);
    expect(scoop.business_date).toBe(BUSINESS_DATE);
  });

  it('writes the modifier row to focus_order_items', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    const rows = mocks.itemsUpsert.mock.calls.map((c: any[]) => c[0]);
    const modifier = rows.find((r: any) => r.name === 'Chocolate');
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

  // ── Success: focus_payments upsert ───────────────────────────────────────────

  it('CRITICAL: upserts one focus_payments row per payment per check', async () => {
    const { deps, mocks } = makeDeps({});
    await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(mocks.paymentsUpsert).toHaveBeenCalledOnce();
    const row = mocks.paymentsUpsert.mock.calls[0][0];
    expect(row).toMatchObject({
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

  it('CRITICAL: calls sync_focus_transactions_to_unified_sales RPC with correct params', async () => {
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
    expect((result as any).error).toBeTruthy();
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

  it('CRITICAL: isolates per-check upsert failure — returns ok with checksWritten=0 (not a fatal error)', async () => {
    // Per-check isolation: a single bad check (e.g. DB constraint violation) is
    // caught and logged, leaving other checks and the unified_sales RPC unaffected.
    // The caller receives { status: 'ok', checksWritten: 0 } so it knows no rows
    // were written but the sync run itself did not abort.
    const { deps } = makeDeps({
      upsertError: { message: 'DB write failed' },
    });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'ok', checksWritten: 0 });
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

  // ── Multiple checks (wider coverage) ─────────────────────────────────────────

  it('processes 2 checks and returns checksWritten=2', async () => {
    const TWO_CHECKS = `<DailyData><Checks>
<Check><CheckRecord><ID>1</ID><Total>5.00</Total></CheckRecord><Seats><Seat><SeatRecord><Key>1</Key></SeatRecord><CheckItemRecord><SeatKey>1</SeatKey><Key>10</Key><RecordNumber>1</RecordNumber><ID>Item1</ID><GuestCheckName>Item1</GuestCheckName><ReportGroupID>10</ReportGroupID><Price>5.00</Price></CheckItemRecord><PaymentRecord><SeatKey>1</SeatKey><Key>11</Key><ID>1</ID><Name>Cash</Name><Amount>5.00</Amount></PaymentRecord></Seat></Seats></Check>
<Check><CheckRecord><ID>2</ID><Total>3.00</Total></CheckRecord><Seats><Seat><SeatRecord><Key>2</Key></SeatRecord><CheckItemRecord><SeatKey>2</SeatKey><Key>20</Key><RecordNumber>2</RecordNumber><ID>Item2</ID><GuestCheckName>Item2</GuestCheckName><ReportGroupID>10</ReportGroupID><Price>3.00</Price></CheckItemRecord><PaymentRecord><SeatKey>2</SeatKey><Key>21</Key><ID>2</ID><Name>Card</Name><Amount>3.00</Amount></PaymentRecord></Seat></Seats></Check>
</Checks></DailyData>`;

    const { deps, mocks } = makeDeps({ xml: TWO_CHECKS });
    const result = await processDayTransactions(deps, MOCK_CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ status: 'ok', checksWritten: 2 });
    expect(mocks.ordersUpsert).toHaveBeenCalledTimes(2);
  });
});
