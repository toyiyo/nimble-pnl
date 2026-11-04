# Focus Lynk Async Datafeed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Status poll loop to `fetchDatafeed` so the Focus sync survives the vendor's SYNC removal.

**Architecture:** All logic changes live in `supabase/functions/_shared/focusLynkClient.ts`. The
`FocusLynkResult` contract does not change. One caller constant changes
(`budgetMs` in `focusSyncDataHandler.ts`). Spec:
`docs/superpowers/specs/2026-08-21-focus-lynk-async-datafeed-design.md`.

**Tech Stack:** Deno edge function (TypeScript), Vitest unit tests.

## Global Constraints

- Write all prose (commit messages, comments) in ASD-STE100. See `docs/STE100_STYLE.md`.
- Work in the worktree: `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/focus-lynk-async-datafeed`, branch `fix/focus-lynk-async-datafeed`.
- Do not change the `FocusLynkResult` type or the `FocusLynkErrorKind` union.
- Do not change any file except: `supabase/functions/_shared/focusLynkClient.ts`, `tests/unit/focusLynkClient.test.ts`, `supabase/functions/_shared/focusSyncDataHandler.ts`, `tests/unit/focusSyncDataHandler.test.ts`.
- No schema changes. No new dependencies.
- Every test goes through the injected `deps.sleep`. No real waits in tests.
- Run tests with: `npx vitest run tests/unit/focusLynkClient.test.ts` (from the worktree root).
- End every commit message with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Response shapes (from the live probe, for reference in tests)

A fulfilled `Status` response wraps the original response:

```json
{ "pos_response": { "header": { "category": "Status", "type": "Response", "request_id": "<base>.2" },
    "payload": {
      "repeated_message_response": {
        "header": { "category": "LegacyDatafeed", "type": "Response", "request_id": "<base>.1" },
        "payload": { "blob_url": "https://...blob.core.windows.net/...", "expires_at_utc": "...",
                     "response": { "result": "Success", "error_condition": "None" } } },
      "response": { "result": "Success", "error_condition": "None" } } } }
```

An unknown reference puts `{ "result": "Failure", "error_condition": "NotFound" }` in the
wrapper payload and has no `blob_url`. The outer response stays `Success`. All HTTP 200.

---

### Task 1: `buildStatusRequest` export

**Files:**
- Modify: `supabase/functions/_shared/focusLynkClient.ts` (add after `buildLynkRequest`, line 182)
- Test: `tests/unit/focusLynkClient.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildStatusRequest(requestReference: string, requestId: string)` →
  `{ pos_request: { header: Record<string, string>; payload: Record<string, string> } }`.
  Task 2 calls it inside the poll loop.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/focusLynkClient.test.ts` after the `buildLynkRequest` describe block.
Add `buildStatusRequest` to the import list at the top of the file.

```typescript
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
```

- [ ] **Step 2: Run the tests to check that they fail**

Run: `npx vitest run tests/unit/focusLynkClient.test.ts`
Expected: FAIL — `buildStatusRequest` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `supabase/functions/_shared/focusLynkClient.ts` directly after `buildLynkRequest`
(after line 182):

```typescript
/**
 * Build the JSON body for a Lynk Status poll request.
 *
 * The Status request asks Focus for the state of an earlier request.
 * The response wraps the referenced message in
 * `pos_response.payload.repeated_message_response`.
 *
 * @param requestReference request_id of the initial LegacyDatafeed request
 * @param requestId        Unique id for this poll request
 */
export function buildStatusRequest(
  requestReference: string,
  requestId: string,
): { pos_request: { header: Record<string, string>; payload: Record<string, string> } } {
  return {
    pos_request: {
      header: {
        category: 'Status',
        type: 'Request',
        request_id: requestId,
      },
      payload: {
        request_reference: requestReference,
      },
    },
  };
}
```

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx vitest run tests/unit/focusLynkClient.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusLynkClient.ts tests/unit/focusLynkClient.test.ts
git commit -m "feat(focus): add buildStatusRequest for the Lynk Status poll

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The Status poll loop (happy paths)

**Files:**
- Modify: `supabase/functions/_shared/focusLynkClient.ts:41-47` (constants), `:190-196` (docblock), `:203-373` (`fetchDatafeed` body)
- Test: `tests/unit/focusLynkClient.test.ts`

**Interfaces:**
- Consumes: `buildStatusRequest` from Task 1.
- Produces: `fetchDatafeed(deps, config, businessDate)` with an internal poll loop.
  The signature and the `FocusLynkResult` return type do not change.
  Internal helper `postLynk(body: unknown)` returns
  `{ ok: true; json: any; status: number } | { ok: false; result: FocusLynkResult }`.
  Internal helper `lynkErrorCondition(posResponse: any): string | undefined`.
  Task 3 adds error branches inside the same loop.

**Warning:** this task deletes the one-shot missing-`blob_url` retry. Delete the two
tests that cover it in the same commit (Step 1 lists them). Do not keep dead tests.

- [ ] **Step 1: Change the tests**

In `tests/unit/focusLynkClient.test.ts`:

**1a. Delete these three tests** (the behavior they pin is deleted or changed):
- `'returns ok:false kind=inprogress when Lynk response has error_condition "InProgress"'` (lines 251–258)
- `'retries once when the first Lynk response is missing blob_url and the second succeeds'` (lines 423–465)
- `'returns kind=parse error after two attempts when both Lynk responses are missing blob_url'` (lines 467–491)

**1b. Add helpers** after the existing `makeFetch` helper:

```typescript
// ── Sequential fetch double for the poll flow ────────────────────────────────

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

const XML_RESPONSE: SeqResponse = { body: SAMPLE_XML };
```

**1c. Add the new describe block** at the end of the `fetchDatafeed` describe:

```typescript
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
});
```

- [ ] **Step 2: Run the tests to check that the new ones fail**

Run: `npx vitest run tests/unit/focusLynkClient.test.ts`
Expected: the new poll tests FAIL. The pre-existing tests that Step 1a kept must still pass.

- [ ] **Step 3: Write the implementation**

In `supabase/functions/_shared/focusLynkClient.ts`:

**3a. Replace the constants block** (lines 41–47):

```typescript
const TIMEOUT_MS = 30_000;

/** Delay between Status polls. Vendor guidance: near 5000 ms. */
const STATUS_POLL_DELAY_MS = 5_000;

/** Maximum Status polls per fetchDatafeed call (~20 s of wait). */
const STATUS_POLL_MAX = 4;
```

**3b. Add a helper** after `isoToFocusDate` (after line 137):

```typescript
/**
 * Read the error_condition from a pos_response.
 *
 * The live probe (2026-08-21) shows the condition at
 * `payload.response.error_condition`. The old top-level path stays as a
 * fallback for safety.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lynkErrorCondition(posResponse: any): string | undefined {
  return posResponse?.payload?.response?.error_condition ?? posResponse?.error_condition;
}
```

**3c. Rewrite the body of `fetchDatafeed`** from the request-id line through the
`const { blobUrl } = syncAttempt;` line (lines 229–373). Keep sections 1 (config
guard), 6 (blob SSRF guard), 7 (blob download), and 8 (blob status guard) as they
are. The new middle section:

```typescript
  // ── 2. Build the Lynk request body ──────────────────────────────────────────

  const requestIdBase = crypto.randomUUID();
  const initialRequestId = `${requestIdBase}.1`;
  let requestBody: ReturnType<typeof buildLynkRequest>;
  try {
    requestBody = buildLynkRequest(businessDate, initialRequestId);
  } catch (e) {
    return {
      ok: false,
      status: 0,
      kind: 'config',
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // ── 3. POST helper for /api/lynk/sync ───────────────────────────────────────

  const syncUrl = `${config.baseUrl.replace(/\/+$/, '')}/api/lynk/sync`;

  /**
   * POST one body to the Lynk sync endpoint.
   * Maps terminal HTTP statuses and a non-JSON body to a FocusLynkResult.
   * On 2xx JSON, returns the parsed body.
   */
  async function postLynk(body: unknown): Promise<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { ok: true; json: any; status: number } | { ok: false; result: FocusLynkResult }
  > {
    let res: Response;
    try {
      res = await deps.fetch(syncUrl, {
        method: 'POST',
        headers: {
          Authorization: basicAuth(config.apiKey, config.apiSecret),
          'Content-Type': 'application/json',
          'focuspos-restaurant-id': config.restaurantGuid,
        },
        body: JSON.stringify(body),
        // Disable redirect-follow so an allow-listed host responding with a 3xx
        // to an internal address cannot bypass the SSRF guard above.
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      return {
        ok: false,
        result: {
          ok: false,
          status: 0,
          kind: 'network',
          error: e instanceof Error ? e.message : 'network error',
        },
      };
    }

    const status = res.status;
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      return {
        ok: false,
        result: {
          ok: false,
          status,
          kind: 'network',
          error: e instanceof Error ? e.message : 'network error reading Lynk sync response body',
        },
      };
    }

    if (status === 401) {
      return { ok: false, result: { ok: false, status, kind: 'auth', error: 'Focus POS API returned 401 Unauthorized' } };
    }
    if (status === 403) {
      return { ok: false, result: { ok: false, status, kind: 'license', error: 'Focus POS API returned 403 Forbidden — check license / API key permissions' } };
    }
    if (status === 404) {
      return { ok: false, result: { ok: false, status, kind: 'not_found', error: 'Focus POS API returned 404 — check the restaurant GUID and base URL' } };
    }
    if (status < 200 || status >= 300) {
      return { ok: false, result: { ok: false, status, kind: 'http', error: `Focus POS Lynk API returned HTTP ${status}` } };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, result: { ok: false, status, kind: 'parse', error: 'Focus POS Lynk API returned a non-JSON body' } };
    }

    return { ok: true, json, status };
  }

  // ── 4. Initial LegacyDatafeed request ───────────────────────────────────────

  const initial = await postLynk(requestBody);
  if (!initial.ok) {
    return initial.result;
  }

  let blobUrl: string | undefined = initial.json?.pos_response?.payload?.blob_url;
  let lastStatus = initial.status;

  // A pending signal is an InProgress condition or a repeated_message_response
  // wrapper. When no response ever shows one, the shape is broken → 'parse'.
  let pendingSignal = lynkErrorCondition(initial.json?.pos_response) === 'InProgress';

  // ── 5. Status poll loop (runs only when the initial response has no blob_url)

  if (!blobUrl) {
    const sleepFn = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    for (let poll = 1; poll <= STATUS_POLL_MAX && !blobUrl; poll++) {
      await sleepFn(STATUS_POLL_DELAY_MS);

      const statusBody = buildStatusRequest(initialRequestId, `${requestIdBase}.${poll + 1}`);
      const pollRes = await postLynk(statusBody);
      if (!pollRes.ok) {
        return pollRes.result;
      }
      lastStatus = pollRes.status;

      const wrapper = pollRes.json?.pos_response?.payload?.repeated_message_response;
      if (wrapper) {
        pendingSignal = true;
        blobUrl = wrapper?.payload?.blob_url;
      } else if (lynkErrorCondition(pollRes.json?.pos_response) === 'InProgress') {
        pendingSignal = true;
      }
    }

    if (!blobUrl) {
      if (pendingSignal) {
        return {
          ok: false,
          status: lastStatus,
          kind: 'inprogress',
          error: 'Focus POS datafeed is not yet ready for this business date (poll cap exhausted)',
        };
      }
      return {
        ok: false,
        status: lastStatus,
        kind: 'parse',
        error: 'Focus POS Lynk response did not contain a blob_url',
      };
    }
  }
```

**3d. Delete** the old `doSyncPost` function, the first-attempt/retry block
(old lines 361–373), and the `BLOB_URL_RETRY_DELAY_MS` constant. The code after
the new section starts at the blob SSRF guard (`if (!isSafeUrl(blobUrl, BLOB_HOST_RE)) {`).

**3e. Change the `fetchDatafeed` docblock** steps list (old lines 190–197) to:

```typescript
 * Steps:
 *  1. SSRF-guard the baseUrl and restaurantGuid.
 *  2. POST /api/lynk/sync (LegacyDatafeed) → look for
 *     `pos_response.payload.blob_url`.
 *  3. When blob_url is absent: poll with Status requests that reference the
 *     initial request_id (STATUS_POLL_DELAY_MS between polls, STATUS_POLL_MAX
 *     polls). The poll response wraps the referenced message in
 *     `pos_response.payload.repeated_message_response`.
 *  4. SSRF-guard the blob_url.
 *  5. GET the blob_url → return the XML text.
```

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx vitest run tests/unit/focusLynkClient.test.ts`
Expected: PASS. Note: the old test `'maps a 200 Lynk response with no blob_url to kind=parse'`
must still pass (its poll responses are non-JSON, which maps to `parse`). Task 3 rewrites it.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusLynkClient.ts tests/unit/focusLynkClient.test.ts
git commit -m "feat(focus): poll the Lynk Status endpoint for the datafeed blob

Focus POS deletes SYNC support for LegacyDatafeed next week. When
the initial response has no blob_url, the client now polls with
Status requests (5000 ms delay, 4 polls maximum). The poll reads
the wrapped response in repeated_message_response. The one-shot
missing-blob_url retry is deleted; the poll replaces it.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Poll error mapping

**Files:**
- Modify: `supabase/functions/_shared/focusLynkClient.ts` (poll loop from Task 2; file docblock lines 1–24; `FocusLynkDeps.sleep` comment lines 67–72)
- Test: `tests/unit/focusLynkClient.test.ts`

**Interfaces:**
- Consumes: the poll loop, `lynkErrorCondition`, and `wrapperBody` helper from Task 2.
- Produces: the final error behavior of `fetchDatafeed`. No new exports.

- [ ] **Step 1: Write the failing tests**

**1a. Add helpers** next to `WRAPPER_PENDING`:

```typescript
const WRAPPER_NOTFOUND = wrapperBody({
  response: { result: 'Failure', error_condition: 'NotFound' },
});

/** A 2xx JSON poll response with no wrapper and no pending condition. */
const NO_SIGNAL_BODY = JSON.stringify({
  pos_response: {
    payload: { response: { result: 'Success', error_condition: 'None' } },
  },
});
```

**1b. Rewrite the old test** `'maps a 200 Lynk response with no blob_url to kind=parse'`
(it passes for the wrong reason after Task 2). Replace it with:

```typescript
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
```

**1c. Add these tests** to the `fetchDatafeed Status poll` describe block:

```typescript
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
```

- [ ] **Step 2: Run the tests to check the failures**

Run: `npx vitest run tests/unit/focusLynkClient.test.ts`
Expected: FAIL — `inner NotFound` (loop keeps polling instead of a NotFound return)
and `unknown inner error_condition` (no `console.warn` call). The cap-exhaustion,
no-signal, non-JSON, 500, 401, and network tests may pass from Task 2 already.

- [ ] **Step 3: Write the implementation**

**3a. In the poll loop from Task 2**, replace the `if (wrapper) { ... }` block with:

```typescript
      const wrapper = pollRes.json?.pos_response?.payload?.repeated_message_response;
      if (wrapper) {
        pendingSignal = true;
        const inner: string | undefined = wrapper?.payload?.response?.error_condition;
        if (inner === 'NotFound') {
          return {
            ok: false,
            status: lastStatus,
            kind: 'inprogress',
            error:
              'Focus POS lost the datafeed request reference (NotFound); a new request starts on the next pass',
          };
        }
        if (inner && inner !== 'None' && inner !== 'InProgress') {
          // Unknown vendor condition — log it so it does not hide behind
          // "still generating". Never log a URL here without redaction.
          console.warn(
            `focusLynkClient: unknown error_condition "${inner}" in a Status poll response`,
          );
        }
        blobUrl = wrapper?.payload?.blob_url;
      } else if (lynkErrorCondition(pollRes.json?.pos_response) === 'InProgress') {
        pendingSignal = true;
      }
```

**3b. Add one log line** before the cap-exhaustion return:

```typescript
      if (pendingSignal) {
        console.warn(
          `focusLynkClient: poll cap exhausted (${STATUS_POLL_MAX} polls) for business date ${businessDate}`,
        );
        return {
          ok: false,
          status: lastStatus,
          kind: 'inprogress',
          error: 'Focus POS datafeed is not yet ready for this business date (poll cap exhausted)',
        };
      }
```

**3c. Replace the file docblock** (lines 1–24) with:

```typescript
/**
 * focusLynkClient.ts
 *
 * Focus POS "Lynk Legacy Datafeed" client.
 *
 * For a given business date, calls:
 *   POST {baseUrl}/api/lynk/sync
 *     body: LegacyDatafeed request with business_date in MM/DD/YYYY
 *     auth: HTTP Basic (apiKey:apiSecret)
 *     header: focuspos-restaurant-id: {restaurantGuid}
 *
 * When the response contains `pos_response.payload.blob_url` (a time-limited
 * Azure SAS URL), the client GETs that URL and returns the XML string.
 *
 * When the response has no blob_url, the datafeed is queued. The client polls
 * the same endpoint with Status requests that reference the initial
 * request_id. The poll response wraps the referenced message in
 * `pos_response.payload.repeated_message_response`. After STATUS_POLL_MAX
 * polls the client returns kind = "inprogress"; the caller retries on the
 * next cron pass.
 *
 * SSRF guard:
 *  - baseUrl must be https + host (sub.)focuspos.com, no userinfo.
 *  - blob_url must be https + host (sub.)blob.core.windows.net, no userinfo.
 *
 * Design ref: docs/superpowers/specs/2026-08-21-focus-lynk-async-datafeed-design.md
 */
```

**3d. Change the `FocusLynkDeps.sleep` comment** (lines 67–72) to:

```typescript
  /**
   * Optional delay function injected for tests so the Status poll does not
   * actually sleep. Production: omit (defaults to a real setTimeout sleep).
   * Tests: pass `() => Promise.resolve()` or a spy that resolves immediately.
   */
```

- [ ] **Step 4: Run the tests to check that they pass**

Run: `npx vitest run tests/unit/focusLynkClient.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusLynkClient.ts tests/unit/focusLynkClient.test.ts
git commit -m "feat(focus): map the Status poll error paths

Inner NotFound returns kind inprogress; the next pass sends a new
request. An unknown error_condition gets a log line. When no
response shows a pending signal, the client returns kind parse, so
a broken response shape stays diagnosable. The cap-exhaustion path
also gets a log line.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Manual sync budget + full verification

**Files:**
- Modify: `supabase/functions/_shared/focusSyncDataHandler.ts:428`
- Test: `tests/unit/focusSyncDataHandler.test.ts:27,657-667`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent constant change).
- Produces: `budgetMs: 45_000` on the manual-sync backfill kick.

- [ ] **Step 1: Change the test**

In `tests/unit/focusSyncDataHandler.test.ts`:
- Line 27 (header comment): change `budgetMs=12_000` to `budgetMs=45_000`.
- Line 657: change the test title to `'calls processBackfillBatch with budgetMs=45_000 and maxDays=3'`.
- Line 666: change `expect(opts.budgetMs).toBe(12_000);` to `expect(opts.budgetMs).toBe(45_000);`.

- [ ] **Step 2: Run the test to check that it fails**

Run: `npx vitest run tests/unit/focusSyncDataHandler.test.ts`
Expected: FAIL — expected 45000, received 12000.

- [ ] **Step 3: Write the implementation**

In `supabase/functions/_shared/focusSyncDataHandler.ts:428`, change:

```typescript
        budgetMs: 12_000,
```

to:

```typescript
        // 45 s: after the async vendor change, one day costs 5–15 s of poll
        // wait. Three days must fit one manual-sync kick (design 2026-08-21).
        budgetMs: 45_000,
```

- [ ] **Step 4: Run the full verification**

Run each command from the worktree root. All must pass:

```bash
npx vitest run tests/unit/focusSyncDataHandler.test.ts
```

```bash
npm run test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

Expected: PASS for all. When `npm run lint` reports pre-existing errors in files
this plan does not touch, report them and continue.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/focusSyncDataHandler.ts tests/unit/focusSyncDataHandler.test.ts
git commit -m "fix(focus): raise the manual sync budget to 45 s

After the async change, one day costs 5 to 15 s of poll wait. The
12 s budget then fits one day per invocation, down from three. The
45 s budget keeps the three-day pace. The budget check runs only
before each day, so day 1 always runs to completion either way.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Spec coverage map

| Spec section | Task |
|---|---|
| New export `buildStatusRequest` | 1 |
| Request ids `${base}.1` / `${base}.${n+1}` | 2 |
| Fast path on initial `blob_url` | 2 |
| Poll loop, `STATUS_POLL_DELAY_MS`, `STATUS_POLL_MAX` | 2 |
| Delete `BLOB_URL_RETRY_DELAY_MS` + one-shot retry | 2 |
| `error_condition` path fix with fallback | 2 |
| `NotFound` → `inprogress` | 3 |
| Unknown condition log | 3 |
| Cap-exhaustion log + `inprogress` | 3 |
| No pending signal → `parse` | 3 |
| Poll HTTP/parse/network mapping | 2 (postLynk) + 3 (tests) |
| Docblock updates | 3 |
| `budgetMs: 45_000` | 4 |
| Test cases 1–14 from the spec | 1–4 |
