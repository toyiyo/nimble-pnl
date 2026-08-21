/**
 * focusLynkClient.test.ts
 *
 * Vitest unit tests for supabase/functions/_shared/focusLynkClient.ts
 *
 * Covers:
 *  - focusApiBaseUrl: production vs sandbox URL selection
 *  - buildLynkRequest: correct body shape (category, type, request_id, business_date)
 *  - fetchDatafeed:
 *      - POSTs to /api/lynk/sync with Basic auth header + focuspos-restaurant-id header
 *      - Sends correct LegacyDatafeed request body with MM/DD/YYYY business date
 *      - Downloads blob_url via GET and returns XML string
 *      - Returns ok:false kind=inprogress when error_condition is "InProgress"
 *      - SSRF guard: rejects non-https or non-focuspos.com / non-blob.core.windows.net URLs
 *      - Maps HTTP errors (401→auth, 403→license, 404→not_found, 5xx→http)
 *      - Maps network throw → kind=network
 *      - Maps bad JSON on 200 → kind=parse
 *      - Unique request_id generated per call
 *
 * Design ref: design §2 (Lynk Datafeed), §6 (SSRF guard), §7 (testing).
 * Plan ref: Task 2.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  focusApiBaseUrl,
  buildLynkRequest,
  buildStatusRequest,
  fetchDatafeed,
  type FocusLynkConfig,
} from '../../supabase/functions/_shared/focusLynkClient.ts';

// ── Constants ────────────────────────────────────────────────────────────────

const PROD_BASE = 'https://pos-api.focuspos.com';
const SANDBOX_BASE = 'https://sandbox-api.focuspos.com';
const GUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';
const BUSINESS_DATE = '2026-06-29'; // YYYY-MM-DD
const BUSINESS_DATE_MMddYYYY = '06/29/2026'; // expected wire format

const BLOB_URL =
  'https://easyshifthq.blob.core.windows.net/feeds/daily-data.xml?sig=abc123';
const SAMPLE_XML = '<?xml version="1.0"?><DailyData><Checks></Checks></DailyData>';

const CONFIG: FocusLynkConfig = {
  baseUrl: PROD_BASE,
  restaurantGuid: GUID,
  apiKey: API_KEY,
  apiSecret: API_SECRET,
};

// ── fetch double ──────────────────────────────────────────────────────────────

type SeqResponse = { status?: number; body?: string; throws?: boolean };

/**
 * Build a fetch mock that answers calls in order from `responses`.
 * The last entry repeats when calls run past the end.
 */
function makeSeqFetch(responses: SeqResponse[]) {
  let call = 0;
  return vi.fn(async (_url: string) => {
    const r = responses[Math.min(call, responses.length - 1)];
    call++;
    if (r.throws) throw new Error('network error');
    const status = r.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => r.body ?? '',
    } as Response;
  });
}

/**
 * Build a two-call fetch double for the happy-path Lynk flow:
 * Call 1 → Lynk sync response (returns blob_url)
 * Call 2+ → Blob download response (returns XML)
 */
function makeFetch(opts: {
  syncStatus?: number;
  syncBody?: string;
  blobStatus?: number;
  blobBody?: string;
  throws?: boolean;
}) {
  const {
    syncStatus = 200,
    syncBody = JSON.stringify({ pos_response: { payload: { blob_url: BLOB_URL } } }),
    blobStatus = 200,
    blobBody = SAMPLE_XML,
    throws = false,
  } = opts;

  return makeSeqFetch([
    { status: syncStatus, body: syncBody, throws },
    { status: blobStatus, body: blobBody },
  ]);
}

/** Initial 2xx response with no blob_url and error_condition InProgress (new path). */
const QUEUED_BODY = JSON.stringify({
  pos_response: {
    header: { category: 'LegacyDatafeed', type: 'Response', request_id: 'x.1' },
    payload: { response: { result: 'Success', error_condition: 'InProgress' } },
  },
});

/** Build a Status response body whose wrapper carries `innerPayload`. */
function wrapperBody(innerPayload: Record<string, unknown>): string {
  return JSON.stringify({
    pos_response: {
      header: { category: 'Status', type: 'Response', request_id: 'x.2' },
      payload: {
        repeated_message_response: {
          header: { category: 'LegacyDatafeed', type: 'Response', request_id: 'x.1' },
          payload: innerPayload,
        },
        response: { result: 'Success', error_condition: 'None' },
      },
    },
  });
}

const WRAPPER_READY = wrapperBody({
  blob_url: BLOB_URL,
  expires_at_utc: '2026-08-21T17:35:53.2566551Z',
  response: { result: 'Success', error_condition: 'None' },
});

const WRAPPER_PENDING = wrapperBody({
  response: { result: 'Success', error_condition: 'InProgress' },
});

const WRAPPER_NOTFOUND = wrapperBody({
  response: { result: 'Failure', error_condition: 'NotFound' },
});

/** A 2xx JSON poll response with no wrapper and no pending condition. */
const NO_SIGNAL_BODY = JSON.stringify({
  pos_response: {
    payload: { response: { result: 'Success', error_condition: 'None' } },
  },
});

const XML_RESPONSE: SeqResponse = { body: SAMPLE_XML };

// ── focusApiBaseUrl ───────────────────────────────────────────────────────────

describe('focusApiBaseUrl', () => {
  it('returns the production base URL for environment="production"', () => {
    const url = focusApiBaseUrl('production');
    expect(url).toBe(PROD_BASE);
  });

  it('returns the sandbox URL when environment="sandbox" and sandboxUrl is provided', () => {
    const url = focusApiBaseUrl('sandbox', SANDBOX_BASE);
    expect(url).toBe(SANDBOX_BASE);
  });

  it('falls back to production URL when environment="sandbox" but no sandboxUrl', () => {
    const url = focusApiBaseUrl('sandbox');
    expect(url).toBe(PROD_BASE);
  });

  it('treats any non-sandbox environment as production', () => {
    expect(focusApiBaseUrl('production')).toBe(PROD_BASE);
    expect(focusApiBaseUrl('unknown' as never)).toBe(PROD_BASE);
  });
});

// ── buildLynkRequest ─────────────────────────────────────────────────────────

describe('buildLynkRequest', () => {
  it('returns an object with pos_request.header.category = "LegacyDatafeed"', () => {
    const body = buildLynkRequest(BUSINESS_DATE, 'req-001');
    expect(body.pos_request.header.category).toBe('LegacyDatafeed');
  });

  it('returns pos_request.header.type = "Request"', () => {
    const body = buildLynkRequest(BUSINESS_DATE, 'req-001');
    expect(body.pos_request.header.type).toBe('Request');
  });

  it('embeds the provided request_id in the header', () => {
    const body = buildLynkRequest(BUSINESS_DATE, 'unique-request-id-42');
    expect(body.pos_request.header.request_id).toBe('unique-request-id-42');
  });

  it('converts YYYY-MM-DD to MM/DD/YYYY in the payload business_date', () => {
    const body = buildLynkRequest(BUSINESS_DATE, 'req-001');
    expect(body.pos_request.payload.business_date).toBe(BUSINESS_DATE_MMddYYYY);
  });

  it('converts 2026-01-05 → 01/05/2026 (zero-pads month and day)', () => {
    const body = buildLynkRequest('2026-01-05', 'req-001');
    expect(body.pos_request.payload.business_date).toBe('01/05/2026');
  });

  it('throws on a malformed date (not YYYY-MM-DD)', () => {
    expect(() => buildLynkRequest('06/29/2026', 'req-001')).toThrow(/YYYY-MM-DD/);
    expect(() => buildLynkRequest('2026-6-29', 'req-001')).toThrow(/YYYY-MM-DD/);
  });
});

// ── buildStatusRequest ───────────────────────────────────────────────────────

describe('buildStatusRequest', () => {
  it('returns pos_request.header.category = "Status" and type = "Request"', () => {
    const body = buildStatusRequest('base.1', 'base.2');
    expect(body.pos_request.header.category).toBe('Status');
    expect(body.pos_request.header.type).toBe('Request');
  });

  it('embeds the provided request_id in the header', () => {
    const body = buildStatusRequest('base.1', 'base.2');
    expect(body.pos_request.header.request_id).toBe('base.2');
  });

  it('embeds the reference in payload.request_reference', () => {
    const body = buildStatusRequest('base.1', 'base.2');
    expect(body.pos_request.payload.request_reference).toBe('base.1');
  });
});

// ── fetchDatafeed ─────────────────────────────────────────────────────────────

describe('fetchDatafeed', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns ok:true + xml string on a successful Lynk call + blob download', async () => {
    const fetchFn = makeFetch({});
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
    if (result.ok) {
      expect(typeof result.status).toBe('number');
      expect(result.status).toBe(200);
    }
  });

  // ── Lynk POST shape ─────────────────────────────────────────────────────────

  it('POSTs to {baseUrl}/api/lynk/sync', async () => {
    const fetchFn = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    const [url] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PROD_BASE}/api/lynk/sync`);
  });

  it('sends Basic auth header derived from apiKey:apiSecret', async () => {
    const fetchFn = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const expected = 'Basic ' + btoa(`${API_KEY}:${API_SECRET}`);
    expect(headers['Authorization']).toBe(expected);
  });

  it('sends the restaurant GUID in focuspos-restaurant-id header', async () => {
    const fetchFn = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['focuspos-restaurant-id']).toBe(GUID);
  });

  it('sends Content-Type application/json on the Lynk POST', async () => {
    const fetchFn = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends business_date in MM/DD/YYYY format in the Lynk body', async () => {
    const fetchFn = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.pos_request.payload.business_date).toBe(BUSINESS_DATE_MMddYYYY);
  });

  // ── Blob download ────────────────────────────────────────────────────────────

  it('GETs the blob_url extracted from the Lynk response payload', async () => {
    const fetchFn = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [blobUrl] = fetchFn.mock.calls[1] as [string, RequestInit?];
    expect(blobUrl).toBe(BLOB_URL);
  });

  it('returns the XML string downloaded from the blob URL', async () => {
    const xml = '<DailyData><Checks><Check>...</Check></Checks></DailyData>';
    const fetchFn = makeFetch({ blobBody: xml });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: true, xml });
  });

  // ── Unique request_id per call ───────────────────────────────────────────────

  it('generates a unique request_id on each call', async () => {
    const fetchFn1 = makeFetch({});
    const fetchFn2 = makeFetch({});
    await fetchDatafeed({ fetch: fetchFn1 }, CONFIG, BUSINESS_DATE);
    await fetchDatafeed({ fetch: fetchFn2 }, CONFIG, BUSINESS_DATE);

    const [, init1] = fetchFn1.mock.calls[0] as [string, RequestInit];
    const [, init2] = fetchFn2.mock.calls[0] as [string, RequestInit];
    const body1 = JSON.parse(init1.body as string);
    const body2 = JSON.parse(init2.body as string);
    expect(body1.pos_request.header.request_id).toBeTruthy();
    expect(body2.pos_request.header.request_id).toBeTruthy();
    expect(body1.pos_request.header.request_id).not.toBe(
      body2.pos_request.header.request_id,
    );
  });

  // ── HTTP errors ──────────────────────────────────────────────────────────────

  it('maps Lynk 401 response to kind=auth', async () => {
    const fetchFn = makeFetch({ syncStatus: 401, syncBody: '{"error":"Unauthorized"}' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, status: 401, kind: 'auth' });
  });

  it('maps Lynk 403 response to kind=license (forbidden / license issue)', async () => {
    const fetchFn = makeFetch({ syncStatus: 403, syncBody: '{"error":"Forbidden"}' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, status: 403, kind: 'license' });
  });

  it('maps Lynk 404 response to kind=not_found', async () => {
    const fetchFn = makeFetch({ syncStatus: 404, syncBody: '{"error":"Not Found"}' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, status: 404, kind: 'not_found' });
  });

  it('maps Lynk 5xx response to kind=http', async () => {
    const fetchFn = makeFetch({ syncStatus: 500, syncBody: 'Internal Server Error' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, status: 500, kind: 'http' });
  });

  it('maps a thrown fetch (network error) to kind=network', async () => {
    const fetchFn = makeFetch({ throws: true });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, kind: 'network' });
  });

  it('maps a non-JSON 200 Lynk response to kind=parse', async () => {
    const fetchFn = makeFetch({ syncBody: 'not json at all{' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, kind: 'parse' });
  });

  it('maps a non-JSON poll body to kind=parse', async () => {
    const fetchFn = makeSeqFetch([
      { body: QUEUED_BODY },
      { body: 'not json at all{' },
    ]);
    const result = await fetchDatafeed(
      { fetch: fetchFn, sleep: () => Promise.resolve() },
      CONFIG,
      BUSINESS_DATE,
    );
    expect(result).toMatchObject({ ok: false, kind: 'parse' });
  });

  // ── SSRF guard ────────────────────────────────────────────────────────────────

  it('SSRF: rejects a baseUrl that is not https (returns kind=config, no fetch)', async () => {
    const fetchFn = makeFetch({});
    const result = await fetchDatafeed(
      { fetch: fetchFn },
      { ...CONFIG, baseUrl: 'http://pos-api.focuspos.com' },
      BUSINESS_DATE,
    );
    expect(result).toMatchObject({ ok: false, kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('SSRF: rejects a baseUrl not on focuspos.com (returns kind=config, no fetch)', async () => {
    const fetchFn = makeFetch({});
    const result = await fetchDatafeed(
      { fetch: fetchFn },
      { ...CONFIG, baseUrl: 'https://evil.example.com' },
      BUSINESS_DATE,
    );
    expect(result).toMatchObject({ ok: false, kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('SSRF: rejects a baseUrl with userinfo (returns kind=config, no fetch)', async () => {
    const fetchFn = makeFetch({});
    const result = await fetchDatafeed(
      { fetch: fetchFn },
      { ...CONFIG, baseUrl: 'https://user:pass@pos-api.focuspos.com' },
      BUSINESS_DATE,
    );
    expect(result).toMatchObject({ ok: false, kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Blob HTTP status guard ───────────────────────────────────────────────────

  it('returns ok:false kind=http when the blob URL returns a non-2xx status', async () => {
    // Simulates an expired Azure SAS URL (403). Without the status check the
    // error HTML body would be passed to the XML parser, which would see an
    // empty feed and advance sync_cursor — permanently skipping that day.
    const fetchFn = makeFetch({ blobStatus: 403, blobBody: '<Error>AuthenticationFailed</Error>' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, kind: 'http', status: 403 });
  });

  it('returns ok:false kind=http when the blob URL returns 404', async () => {
    const fetchFn = makeFetch({ blobStatus: 404, blobBody: '<Error>BlobNotFound</Error>' });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, kind: 'http', status: 404 });
  });

  // ── SSRF: SSRF error message redacts SAS token query params ─────────────────

  it('SSRF: blob_url error message does not include query string (SAS token redacted)', async () => {
    const maliciousBlobBody = JSON.stringify({
      pos_response: {
        // A URL that passes the blob host check but has query params that should be redacted
        // (use a non-blob URL to trigger the SSRF rejection path)
        payload: { blob_url: 'https://evil.com/file.xml?sig=SECRET&se=2026' },
      },
    });
    const fetchFn = makeFetch({ syncBody: maliciousBlobBody });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, kind: 'config' });
    if (!result.ok) {
      expect(result.error).not.toContain('sig=SECRET');
      expect(result.error).not.toContain('se=2026');
    }
  });

  it('SSRF: rejects a blob_url not on blob.core.windows.net (returns kind=config)', async () => {
    const maliciousBlobBody = JSON.stringify({
      pos_response: {
        payload: { blob_url: 'https://evil.com/steal-data' },
      },
    });
    const fetchFn = makeFetch({ syncBody: maliciousBlobBody });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: false, kind: 'config' });
    // Only 1 call — the blob GET must not have been made
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('SSRF: accepts a blob_url on a subdomain of blob.core.windows.net', async () => {
    const validBlobUrl =
      'https://storage123.blob.core.windows.net/container/file.xml?sig=xyz';
    const fetchFn = makeFetch({
      syncBody: JSON.stringify({
        pos_response: { payload: { blob_url: validBlobUrl } },
      }),
    });
    const result = await fetchDatafeed({ fetch: fetchFn }, CONFIG, BUSINESS_DATE);
    expect(result).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  // ── Config guard ─────────────────────────────────────────────────────────────

  it('returns kind=config when restaurantGuid is empty', async () => {
    const fetchFn = makeFetch({});
    const result = await fetchDatafeed(
      { fetch: fetchFn },
      { ...CONFIG, restaurantGuid: '' },
      BUSINESS_DATE,
    );
    expect(result).toMatchObject({ ok: false, kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // ── Status poll loop ─────────────────────────────────────────────────────────

  describe('fetchDatafeed Status poll', () => {
    const noSleep = () => Promise.resolve();

    it('fast path: blob_url in the initial response → no Status POST, no sleep', async () => {
      const fetchFn = makeFetch({});
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: sleepMock },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
      expect(fetchFn).toHaveBeenCalledTimes(2); // sync POST + blob GET
      expect(sleepMock).not.toHaveBeenCalled();
    });

    it('queued initial response → sleeps 5000 ms, then POSTs a Status request', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { body: WRAPPER_READY },
        XML_RESPONSE,
      ]);
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: sleepMock },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
      expect(sleepMock).toHaveBeenCalledTimes(1);
      expect(sleepMock).toHaveBeenCalledWith(5000);

      // The second POST is a Status request that references the initial request_id.
      const [, initInitial] = fetchFn.mock.calls[0] as [string, RequestInit];
      const [pollUrl, initPoll] = fetchFn.mock.calls[1] as [string, RequestInit];
      expect(pollUrl).toBe(`${PROD_BASE}/api/lynk/sync`);
      const initialBody = JSON.parse(initInitial.body as string);
      const pollBody = JSON.parse(initPoll.body as string);
      expect(pollBody.pos_request.header.category).toBe('Status');
      expect(pollBody.pos_request.payload.request_reference).toBe(
        initialBody.pos_request.header.request_id,
      );
    });

    it('poll request ids follow ${base}.${n}: initial .1, polls .2 and .3', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { body: WRAPPER_PENDING },
        { body: WRAPPER_READY },
        XML_RESPONSE,
      ]);
      await fetchDatafeed({ fetch: fetchFn, sleep: noSleep }, CONFIG, BUSINESS_DATE);

      const ids = [0, 1, 2].map((i) => {
        const [, init] = fetchFn.mock.calls[i] as [string, RequestInit];
        return JSON.parse(init.body as string).pos_request.header.request_id as string;
      });
      expect(ids[0]).toMatch(/\.1$/);
      expect(ids[1]).toMatch(/\.2$/);
      expect(ids[2]).toMatch(/\.3$/);
      const base = ids[0].slice(0, -2);
      expect(ids[1]).toBe(`${base}.2`);
      expect(ids[2]).toBe(`${base}.3`);
    });

    it('blob_url arrives on poll 3 → three sleeps of 5000 ms', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { body: WRAPPER_PENDING },
        { body: WRAPPER_PENDING },
        { body: WRAPPER_READY },
        XML_RESPONSE,
      ]);
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: sleepMock },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
      expect(sleepMock).toHaveBeenCalledTimes(3);
      expect(sleepMock).toHaveBeenNthCalledWith(3, 5000);
    });

    it('initial response with the OLD top-level error_condition path enters the poll', async () => {
      // The old dead-path shape stays supported as a fallback.
      const oldShape = JSON.stringify({ pos_response: { error_condition: 'InProgress' } });
      const fetchFn = makeSeqFetch([
        { body: oldShape },
        { body: WRAPPER_READY },
        XML_RESPONSE,
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
      expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('initial response with the NEW payload.response error_condition path enters the poll', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { body: WRAPPER_READY },
        XML_RESPONSE,
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
    });

    it('cap exhaustion: 4 pending polls → kind=inprogress', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { body: WRAPPER_PENDING },
      ]);
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: sleepMock },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: false, kind: 'inprogress' });
      expect(fetchFn).toHaveBeenCalledTimes(5); // initial + 4 polls
      expect(sleepMock).toHaveBeenCalledTimes(4);
    });

    it('inner NotFound → kind=inprogress with a NotFound message, no further polls', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { body: WRAPPER_NOTFOUND },
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: false, kind: 'inprogress' });
      if (!result.ok) {
        expect(result.error).toMatch(/NotFound/);
      }
      expect(fetchFn).toHaveBeenCalledTimes(2); // initial + 1 poll, then stop
    });

    it('no pending signal in any response → kind=parse, not inprogress', async () => {
      // Initial: 2xx JSON, no blob_url, no condition. Polls: no wrapper, no condition.
      const noSignalInitial = JSON.stringify({ pos_response: { payload: {} } });
      const fetchFn = makeSeqFetch([
        { body: noSignalInitial },
        { body: NO_SIGNAL_BODY },
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: false, kind: 'parse' });
      if (!result.ok) {
        expect(result.error).toMatch(/blob_url/);
      }
    });

    it('unknown inner error_condition → logs the value and keeps polling', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const throttled = wrapperBody({
          response: { result: 'Failure', error_condition: 'Throttled' },
        });
        const fetchFn = makeSeqFetch([
          { body: QUEUED_BODY },
          { body: throttled },
          { body: WRAPPER_READY },
          XML_RESPONSE,
        ]);
        const result = await fetchDatafeed(
          { fetch: fetchFn, sleep: noSleep },
          CONFIG,
          BUSINESS_DATE,
        );
        expect(result).toMatchObject({ ok: true, xml: SAMPLE_XML });
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Throttled'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('HTTP 500 on a poll → kind=http with status 500', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { status: 500, body: 'Internal Server Error' },
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: false, kind: 'http', status: 500 });
    });

    it('HTTP 401 on a poll → kind=auth', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { status: 401, body: '{"error":"Unauthorized"}' },
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: false, kind: 'auth', status: 401 });
    });

    it('network throw on a poll → kind=network', async () => {
      const fetchFn = makeSeqFetch([
        { body: QUEUED_BODY },
        { throws: true },
      ]);
      const result = await fetchDatafeed(
        { fetch: fetchFn, sleep: noSleep },
        CONFIG,
        BUSINESS_DATE,
      );
      expect(result).toMatchObject({ ok: false, kind: 'network' });
    });
  });
});
