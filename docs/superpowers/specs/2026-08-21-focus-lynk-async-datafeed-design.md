# Focus Lynk async datafeed — design

**Date:** 2026-08-21
**Status:** Approved by Jose (chat, 2026-08-21)
**Branch:** `fix/focus-lynk-async-datafeed`
**Type:** Hotfix

## Problem

Focus POS will delete SYNC support for the `LegacyDatafeed` request next week
(email from Josh Meier, Focus API contact, 2026-08-21). The legacy datafeed
file is made on demand and takes 5 to 15 seconds. After the change, the
initial request only queues the work. The client must poll with a `Status`
request until the response contains the blob URL.

Our client sends the SYNC request today and expects the `blob_url` in the
initial response ([focusLynkClient.ts:344](../../../supabase/functions/_shared/focusLynkClient.ts)).
Without a change, every Focus sync breaks when the vendor removes SYNC.

## Evidence (live probe, 2026-08-21)

We made real calls to the production API before this design
(script: `probe_focus_async.mjs`, run by Jose with production credentials).
Results, with SAS query strings redacted:

1. **Initial request** — `POST https://pos-api.focuspos.com/api/lynk/sync`,
   `category: "LegacyDatafeed"`, `request_id: "probe39431.1"` → HTTP 200:

   ```json
   {
     "pos_response": {
       "header": { "category": "LegacyDatafeed", "type": "Response", "request_id": "probe39431.1" },
       "payload": {
         "blob_url": "https://focuspossocketstorage.blob.core.windows.net/30128/datafeed/FTP08202026-30128-D.XML?<redacted>",
         "expires_at_utc": "2026-08-21T17:35:53.2566551Z",
         "response": { "result": "Success", "error_condition": "None" }
       }
     }
   }
   ```

2. **Status request, valid reference** — same endpoint, `category: "Status"`,
   `payload.request_reference: "probe39431.1"` → HTTP 200. The payload wraps
   the original response in `repeated_message_response`:

   ```json
   {
     "pos_response": {
       "header": { "category": "Status", "type": "Response", "request_id": "probe39431.2" },
       "payload": {
         "repeated_message_response": {
           "header": { "category": "LegacyDatafeed", "type": "Response", "request_id": "probe39431.1" },
           "payload": {
             "blob_url": "https://focuspossocketstorage.blob.core.windows.net/30128/datafeed/FTP08202026-30128-D.XML?<redacted>",
             "expires_at_utc": "2026-08-21T17:35:53.2566551Z",
             "response": { "result": "Success", "error_condition": "None" }
           }
         },
         "response": { "result": "Success", "error_condition": "None" }
       }
     }
   }
   ```

3. **Status request, unknown reference** (`request_reference: "probe39431.777"`)
   → HTTP 200. The outer response says `Success`. The inner payload says
   `Failure` / `NotFound` and has no `blob_url`:

   ```json
   {
     "pos_response": {
       "header": { "category": "Status", "type": "Response", "request_id": "probe39431.3" },
       "payload": {
         "repeated_message_response": {
           "header": { "category": "Status", "type": "Request", "request_id": "probe39431.777" },
           "payload": {
             "response": { "result": "Failure", "error_condition": "NotFound" }
           }
         },
         "response": { "result": "Success", "error_condition": "None" }
       }
     }
   }
   ```

4. **Blob download** (earlier probe run, same day) — HTTP 200,
   4 853 169 bytes, starts with `<DailyData>`.

Facts this probe establishes:

- The Status poll uses the **same endpoint** `/api/lynk/sync`. The
  `header.category` field selects the operation. This confirms the note in
  [2026-07-01-focus-pos-transactions-design.md](2026-07-01-focus-pos-transactions-design.md)
  (line 23).
- In a Status response, the `blob_url` sits at
  `pos_response.payload.repeated_message_response.payload.blob_url`.
- `error_condition` sits at `payload.response.error_condition` — not at
  `pos_response.error_condition`. The check at
  [focusLynkClient.ts:331](../../../supabase/functions/_shared/focusLynkClient.ts)
  reads a path that does not appear in real responses. That check is dead code.
- The initial call still returns the `blob_url` synchronously today. The
  queued shape is the one state the probe could not show. Per the vendor
  email, a queued request answers without a `blob_url`; the poll response for
  a pending request carries `error_condition: "InProgress"` (the constant our
  client already names).

Search notes: "0313.1" (the vendor's example id) is not in the Supabase logs
(24-hour window) and not in Grafana Loki (30 days). The public Focus docs
cover only the FocusLink v2 REST API, not the private Lynk API.

## Approaches considered

1. **Poll loop inside `fetchDatafeed`** — keep the `FocusLynkResult`
   contract; poll in-process; fall back to kind `'inprogress'`. **Chosen.**
2. Two-phase poll across cron passes with state in `focus_datafeed_state`.
   Rejected: needs a migration, changes the scheduler and all callers, and
   the queued request can expire in the 2-hour gap between passes.
3. Poll in each handler via a new `'queued'` result kind. Rejected: breaks
   the result contract and touches 5 handlers plus their tests.

## Design

All changes live in one file:
[supabase/functions/_shared/focusLynkClient.ts](../../../supabase/functions/_shared/focusLynkClient.ts).
The `FocusLynkResult` contract does not change. The five callers stay
untouched:

- [focusTransactionSyncHandler.ts:304](../../../supabase/functions/_shared/focusTransactionSyncHandler.ts) — maps kind `'inprogress'` to `{status: 'inprogress'}` (lines 307–308); range sync records "InProgress on <date>" as a soft error (lines 519–521)
- [focusSyncDataHandler.ts:57](../../../supabase/functions/_shared/focusSyncDataHandler.ts) (default fallback at line 325)
- [focusBulkSyncHandler.ts:66](../../../supabase/functions/_shared/focusBulkSyncHandler.ts) (used at line 268)
- [focusBackfillSyncHandler.ts:32](../../../supabase/functions/_shared/focusBackfillSyncHandler.ts) (used at line 255)
- [focusBackfillBatch.ts:167](../../../supabase/functions/_shared/focusBackfillBatch.ts) — `'inprogress'` does not advance `sync_cursor`

### Request ids

Generate `base = crypto.randomUUID()` once per `fetchDatafeed` call (today:
[focusLynkClient.ts:231](../../../supabase/functions/_shared/focusLynkClient.ts)).
The initial request uses `${base}.1`. Poll *n* uses `${base}.${n + 1}` and
sets `payload.request_reference = "${base}.1"`. This matches the vendor's
dotted convention ("0313.1" → "0313.2").

### New export

`buildStatusRequest(requestReference, requestId)` next to `buildLynkRequest`
([focusLynkClient.ts:165](../../../supabase/functions/_shared/focusLynkClient.ts)).
It returns:

```json
{
  "pos_request": {
    "header": { "category": "Status", "type": "Request", "request_id": "<requestId>" },
    "payload": { "request_reference": "<requestReference>" }
  }
}
```

### Flow in `fetchDatafeed`

1. Guard the config (unchanged).
2. POST the `LegacyDatafeed` request to `/api/lynk/sync`
   ([focusLynkClient.ts:246](../../../supabase/functions/_shared/focusLynkClient.ts)).
3. Map terminal HTTP statuses as today: 401 → `auth`, 403 → `license`,
   404 → `not_found`, other non-2xx → `http`, non-JSON → `parse`.
4. If the response payload has a `blob_url`: skip the poll. This is the fast
   path. It keeps the client correct before and after the vendor change.
5. Else: poll. Sleep 5 000 ms (`STATUS_POLL_DELAY_MS`), then POST a `Status`
   request. Read the inner envelope at
   `pos_response.payload.repeated_message_response`. Repeat up to 4 polls
   (`STATUS_POLL_MAX`).
6. When the inner payload has a `blob_url`: SSRF-guard it, download the XML
   (unchanged, [focusLynkClient.ts:377–441](../../../supabase/functions/_shared/focusLynkClient.ts)).
7. When the polls run out: return kind `'inprogress'`. Callers retry on the
   next cron pass with a fresh request; the cursor does not advance.

### Error mapping in the poll

Read `error_condition` from the inner payload
(`repeated_message_response.payload.response.error_condition`):

| Observation | Result |
|---|---|
| Inner `blob_url` present | Proceed to blob download |
| Inner `error_condition: "InProgress"`, or no `blob_url` and no terminal condition | Keep polling; `'inprogress'` after the cap |
| Inner `error_condition: "NotFound"` | Return `'inprogress'` with the message "Focus POS lost the datafeed request reference (NotFound); a new request starts on the next pass" |
| HTTP 401 / 403 / 404 / other non-2xx on the poll | Same mapping as the initial call |
| Non-JSON poll body | `parse` |
| Network error | `network` |

The initial response check also changes: read
`pos_response.payload.response.error_condition`, and keep the old
`pos_response.error_condition` path as a fallback. The old path alone never
matches real responses (probe evidence above).

### Deletions

- The one-shot missing-`blob_url` retry and its constant
  `BLOB_URL_RETRY_DELAY_MS`
  ([focusLynkClient.ts:47](../../../supabase/functions/_shared/focusLynkClient.ts),
  [363–368](../../../supabase/functions/_shared/focusLynkClient.ts)).
  The poll loop replaces it: a missing `blob_url` now means "queued", and
  the Status poll is the retry.

### Constants

| Name | Value | Reason |
|---|---|---|
| `STATUS_POLL_DELAY_MS` | `5_000` | Vendor guidance ("sleeping 5000ms or whatever interval you choose") |
| `STATUS_POLL_MAX` | `4` | 4 polls ≈ 20 s of wait, above the stated 5–15 s file build time |
| `TIMEOUT_MS` | `30_000` (unchanged, [focusLynkClient.ts:41](../../../supabase/functions/_shared/focusLynkClient.ts)) | Per-fetch cap |

### Timing budget

Worst case per business day: 1 initial POST + 4 polls + 1 blob GET, each
capped at 30 s, plus 20 s of sleep. Sleep does not consume edge-function CPU
time. The bulk and backfill handlers process several days per invocation;
the `'inprogress'` fallback keeps correctness when a function nears its
wall-clock limit, because the cursor does not advance on `'inprogress'`.

### Behavior change to note

Today an `InProgress` response returns at once with kind `'inprogress'`.
After this change the client polls up to 4 times first, then returns
`'inprogress'`. Tests that assert the immediate return will change to cover
the poll path.

## Testing

Update [tests/unit/focusLynkClient.test.ts](../../../tests/unit/focusLynkClient.test.ts)
(~40 tests today). All timings go through the injected `deps.sleep`; no real
waits.

New and changed cases:

1. `buildStatusRequest` — category `Status`, type `Request`, `request_id`
   embed, `request_reference` embed.
2. Fast path — initial response with `blob_url` → no Status POST, no sleep.
3. Queued initial response (2xx JSON, no `blob_url`) → sleep 5 000 ms →
   Status POST with `request_reference = <initial request_id>`.
4. Poll request ids are unique and follow `${base}.${n}`.
5. `blob_url` in `repeated_message_response` on poll 1 → blob download runs.
6. `blob_url` arrives on poll 3 → two sleeps of 5 000 ms before it.
7. Cap exhaustion (4 polls, still `InProgress`) → kind `'inprogress'`.
8. Inner `NotFound` → kind `'inprogress'` with the NotFound message.
9. Initial response with `payload.response.error_condition: "InProgress"`
   and no `blob_url` → enters the poll (not an instant return).
10. Terminal HTTP error (e.g. 500) on a poll → kind `'http'`.
11. Existing SSRF, auth mapping, parse, and blob-download cases stay green.

## Out of scope

- The portal path (`password_encrypted`, `focus_http_request` SQL transport)
  — a different flow, not touched by the vendor change.
- The datafeed XML parser
  ([focusDatafeedParser.ts](../../../supabase/functions/_shared/focusDatafeedParser.ts)).
- Schema changes. None needed.
