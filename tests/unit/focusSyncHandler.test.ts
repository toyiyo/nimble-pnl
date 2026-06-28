/**
 * focusSyncHandler.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusSyncHandler.ts
 *
 * Coverage:
 *  - Happy path: fetch → parse → upsert focus_daily_reports with correct columns
 *  - Empty report ({ok:false,reason:'empty'}): upserts a zeroed row, returns {status:'empty'}
 *  - Parse error ({ok:false,reason:'parse_error'}): does NOT upsert, returns {status:'error'}
 *  - Upsert conflict target: restaurant_id, business_date, revenue_center
 *  - Upsert includes items_json, payments_json, order_types_json, raw_totals_json
 *  - Date formatting passed to buildReportUrl: MM/DD/YYYY
 *  - Supabase error surfaces as {status:'error', error}
 *
 * Design ref: plan Task 6; spec §8 (_shared/focusSyncHandler.ts)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  processReportDay,
  type SyncDeps,
  type SyncResult,
} from '../../supabase/functions/_shared/focusSyncHandler';
import type { FocusConnection } from '../../supabase/functions/_shared/focusReportClient';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONN: FocusConnection = {
  reportBaseUrl: 'https://mfprod-1.myfocuspos.com',
  reportPath: '/ReportServer?/generalstorereports/revenuecenter',
  dbServer: 'mfaz-rep-1',
  dbCatalog: 'KAHALA2',
  reportUserId: 'testuser',
  storeId: '15312',
  revenueCenter: '',
};

/** Restaurant UUID used as the primary key in the upsert */
const RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

/** Business date under test (ISO string) */
const BUSINESS_DATE = '2026-06-27';

/** Minimal Revenue Center HTML that the real parser can successfully parse */
const VALID_HTML = `<html><body><table>
<tr><td>Revenue Center</td><td>Units</td><td>Sales</td></tr>
<tr><td>Dine-In</td><td></td><td></td></tr>
<tr><td>Scoop Single</td><td>10</td><td>$29.90</td></tr>
<tr><td>Net Sales</td><td></td><td>$29.90</td></tr>
<tr><td>Inclusive Tax</td><td></td><td>$2.39</td></tr>
<tr><td>Subtotal Discounts</td><td></td><td>$0.00</td></tr>
<tr><td>Retained Tips</td><td></td><td>$3.00</td></tr>
<tr><td>Refunds</td><td></td><td>$0.00</td></tr>
<tr><td>Total Sales</td><td></td><td>$32.29</td></tr>
<tr><td>Payments By Tender</td><td></td><td></td></tr>
<tr><td>Cash</td><td></td><td>$32.29</td></tr>
<tr><td>Sales By Order Type</td><td></td><td></td></tr>
<tr><td>Eat In</td><td></td><td>$32.29</td></tr>
</table></body></html>`;

/** HTML fixture that produces an empty parse result (structure found, no items, zero totals) */
const EMPTY_HTML = `<html><body><table>
<tr><td>Revenue Center</td><td>Units</td><td>Sales</td></tr>
<tr><td>Dine-In</td><td></td><td></td></tr>
<tr><td>Net Sales</td><td></td><td>$0.00</td></tr>
<tr><td>Inclusive Tax</td><td></td><td>$0.00</td></tr>
<tr><td>Subtotal Discounts</td><td></td><td>$0.00</td></tr>
<tr><td>Retained Tips</td><td></td><td>$0.00</td></tr>
<tr><td>Refunds</td><td></td><td>$0.00</td></tr>
<tr><td>Total Sales</td><td></td><td>$0.00</td></tr>
</table></body></html>`;

/** Garbage HTML: no recognizable report structure */
const GARBAGE_HTML = '<html><body><p>Not a report</p></body></html>';

// ── Helpers: Supabase mock builder ────────────────────────────────────────────

/**
 * Build a minimal Supabase-like client mock.
 * The upsert chain: .from().upsert().onConflict().select() must resolve.
 */
function makeSupabaseMock(opts: { error?: string } = {}) {
  const selectMock = vi.fn().mockResolvedValue({
    data: opts.error ? null : [{}],
    error: opts.error ? { message: opts.error } : null,
  });
  const onConflictMock = vi.fn().mockReturnValue({ select: selectMock });
  const upsertMock = vi.fn().mockReturnValue({ onConflict: onConflictMock });
  const fromMock = vi.fn().mockReturnValue({ upsert: upsertMock });

  return {
    client: { from: fromMock },
    mocks: { fromMock, upsertMock, onConflictMock, selectMock },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('processReportDay', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  describe('happy path (valid report)', () => {
    let mocks: ReturnType<typeof makeSupabaseMock>['mocks'];
    let upsertPayload: Record<string, unknown>;
    let result: SyncResult;

    beforeEach(async () => {
      const { client, mocks: m } = makeSupabaseMock();
      mocks = m;

      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(VALID_HTML),
      });

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      result = await processReportDay(deps, CONN, BUSINESS_DATE);

      // Capture the upsert payload for inspection
      upsertPayload = mocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
    });

    it('returns status:"ok"', () => {
      expect(result.status).toBe('ok');
    });

    it('calls supabase.from("focus_daily_reports")', () => {
      expect(mocks.fromMock).toHaveBeenCalledWith('focus_daily_reports');
    });

    it('upserts restaurant_id', () => {
      expect(upsertPayload).toMatchObject({ restaurant_id: RESTAURANT_ID });
    });

    it('upserts the correct business_date', () => {
      expect(upsertPayload).toMatchObject({ business_date: BUSINESS_DATE });
    });

    it('upserts revenue_center from the parsed day', () => {
      // The VALID_HTML puts items under "Dine-In" revenue center
      expect(upsertPayload).toHaveProperty('revenue_center');
    });

    it('upserts numeric totals: net_sales', () => {
      expect(upsertPayload).toMatchObject({ net_sales: 29.90 });
    });

    it('upserts numeric totals: total_tax', () => {
      expect(upsertPayload).toMatchObject({ total_tax: 2.39 });
    });

    it('upserts numeric totals: retained_tips', () => {
      expect(upsertPayload).toMatchObject({ retained_tips: 3.00 });
    });

    it('upserts items_json as an array', () => {
      expect(Array.isArray(upsertPayload.items_json)).toBe(true);
      expect((upsertPayload.items_json as unknown[]).length).toBeGreaterThan(0);
    });

    it('upserts payments_json as an array', () => {
      expect(Array.isArray(upsertPayload.payments_json)).toBe(true);
    });

    it('upserts order_types_json as an array', () => {
      expect(Array.isArray(upsertPayload.order_types_json)).toBe(true);
    });

    it('upserts raw_totals_json as an object', () => {
      expect(typeof upsertPayload.raw_totals_json).toBe('object');
      expect(upsertPayload.raw_totals_json).not.toBeNull();
    });

    it('calls onConflict with the three unique-key columns', () => {
      const conflictArg = mocks.onConflictMock.mock.calls[0][0] as string;
      expect(conflictArg).toContain('restaurant_id');
      expect(conflictArg).toContain('business_date');
      expect(conflictArg).toContain('revenue_center');
    });

    it('passes StartDate and EndDate in MM/DD/YYYY format to the fetch', () => {
      // The fetch mock's first argument is the URL
      const fetchMockArg = result; // we need to check via fetchMock inspection
      // Actually check via the upsertPayload is indirect — let's inspect the URL
      // by pulling it from the fetch mock's recorded call
    });
  });

  // ── fetch URL format ─────────────────────────────────────────────────────────

  describe('URL construction', () => {
    it('passes StartDate and EndDate in MM/DD/YYYY format to the report URL', async () => {
      let capturedUrl: string = '';

      const fetchMock = vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          status: 200,
          headers: { get: () => null },
          text: () => Promise.resolve(VALID_HTML),
        });
      });

      const { client } = makeSupabaseMock();

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      await processReportDay(deps, CONN, '2026-06-27');

      // Expect StartDate=06%2F27%2F2026 and EndDate=06%2F27%2F2026 in the URL
      expect(capturedUrl).toContain('StartDate=06%2F27%2F2026');
      expect(capturedUrl).toContain('EndDate=06%2F27%2F2026');
    });
  });

  // ── Empty report path ────────────────────────────────────────────────────────

  describe('empty report ({ok:false, reason:"empty"})', () => {
    it('returns {status:"empty"}', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(EMPTY_HTML),
      });

      const { client, mocks } = makeSupabaseMock();

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      const result = await processReportDay(deps, CONN, BUSINESS_DATE);
      expect(result.status).toBe('empty');
    });

    it('upserts a zeroed row (does NOT skip the upsert)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(EMPTY_HTML),
      });

      const { client, mocks } = makeSupabaseMock();

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      await processReportDay(deps, CONN, BUSINESS_DATE);

      // Upsert should still have been called
      expect(mocks.upsertMock).toHaveBeenCalledOnce();

      // Payload should have zeroed numerics
      const payload = mocks.upsertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(payload).toMatchObject({
        restaurant_id: RESTAURANT_ID,
        business_date: BUSINESS_DATE,
        net_sales: 0,
        total_tax: 0,
        subtotal_discounts: 0,
        retained_tips: 0,
        refunds: 0,
        total_sales: 0,
        items_json: [],
        payments_json: [],
        order_types_json: [],
      });
    });
  });

  // ── Parse error path ─────────────────────────────────────────────────────────

  describe('parse error ({ok:false, reason:"parse_error"})', () => {
    it('returns {status:"error"}', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(GARBAGE_HTML),
      });

      const { client, mocks } = makeSupabaseMock();

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      const result = await processReportDay(deps, CONN, BUSINESS_DATE);
      expect(result.status).toBe('error');
    });

    it('does NOT call supabase.upsert on parse_error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(GARBAGE_HTML),
      });

      const { client, mocks } = makeSupabaseMock();

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      await processReportDay(deps, CONN, BUSINESS_DATE);

      expect(mocks.upsertMock).not.toHaveBeenCalled();
    });
  });

  // ── Supabase error path ──────────────────────────────────────────────────────

  describe('supabase upsert error', () => {
    it('returns {status:"error"} when supabase returns an error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(VALID_HTML),
      });

      const { client } = makeSupabaseMock({ error: 'insert failed' });

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      const result = await processReportDay(deps, CONN, BUSINESS_DATE);
      expect(result.status).toBe('error');
    });

    it('surfaces the error message when supabase fails', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(VALID_HTML),
      });

      const { client } = makeSupabaseMock({ error: 'duplicate key violation' });

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      const result = await processReportDay(deps, CONN, BUSINESS_DATE);
      expect(result.status).toBe('error');
      expect((result as { status: 'error'; error: string }).error).toContain(
        'duplicate key violation',
      );
    });
  });

  // ── Fetch network error ──────────────────────────────────────────────────────

  describe('fetch network error', () => {
    it('returns {status:"error"} on a network failure', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const { client } = makeSupabaseMock();

      const deps: SyncDeps = {
        fetch: fetchMock,
        supabase: client as any,
        restaurantId: RESTAURANT_ID,
      };

      const result = await processReportDay(deps, CONN, BUSINESS_DATE);
      expect(result.status).toBe('error');
    });
  });
});
