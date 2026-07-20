# Revel POS Integration — Design

**Date:** 2026-07-06
**Status:** Approved (pending user spec review)
**Scope:** v1 = sales ingestion only (parity with Toast/Square/Clover/Shift4). Labor (`timesheet.*`) and inventory (`inout.stock`) are explicitly out of scope for v1.

---

## 1. Summary

Add Revel Systems as a POS integration alongside Toast, Square, Clover, and Shift4. Sales flow into the shared `unified_sales` table (`pos_system = 'revel'`) and feed the existing P&L, categorization, and adapter layers unchanged.

Revel differs architecturally from every existing integration: it uses a **partner model**. EasyShiftHQ registers once as a Revel partner (paid **Partner Connect** subscription) and receives **one** set of credentials (`client_id`, `client_secret`, and a webhook signing secret) that are used for **all** merchants. A restaurant connects by (a) authorizing EasyShiftHQ inside their own Revel account and (b) telling us their Revel instance subdomain. There are **no per-restaurant secrets** to collect or encrypt.

The result is a hybrid of two existing patterns:
- **Toast** — table layout, shared order processor, financial-breakdown RPC, webhook receiver + bulk-sync cron.
- **Square** — single global webhook subscription + single shared signing secret (partner-level, not per-restaurant).

## 2. Ingestion architecture (approach A: webhook-first hybrid)

```
                    ┌─── order.finalized webhook (real-time) ───┐
Revel Cloud ────────┤                                            ├──▶ revel-webhook (public, HMAC-SHA1)
                    └─── message-log / order poll (recovery) ────┘         │
                                                                            ▼
                                       _shared/revelOrderProcessor.processOrder()
                                                                            │
                        revel_orders / revel_order_items / revel_payments   │
                                                                            ▼
                              RPC revel_sync_financial_breakdown()  ──▶ unified_sales (pos_system='revel')
                                                                            ▼
                                    existing P&L / categorization / adapters (unchanged)
```

- **Primary path — webhooks:** Revel POSTs `order.finalized` to a single public receiver. Real-time, low latency.
- **Recovery/seed path — polling:** a cron `revel-bulk-sync` (1) seeds the initial 90-day history (webhooks only fire forward), and (2) replays missed/failed webhooks via `GET /external/message-log`.

Webhook-only was rejected: no historical backfill and no gap recovery violates the project's data-accuracy tenet. Polling-only was rejected: loses the real-time push that motivated this integration.

## 3. Authentication & credentials

### Partner-level secrets (Supabase env vars, set once)
- `REVEL_CLIENT_ID` — partner OAuth client id
- `REVEL_CLIENT_SECRET` — partner OAuth client secret
- `REVEL_AUDIENCE` — `https://api.revelsystems.com`
- `REVEL_WEBHOOK_SECRET` — HMAC-SHA1 shared signing secret for webhook verification

Base URLs:
- Auth: `https://authentication.revelup.com/oauth/token` (POST `client_id`/`client_secret`/`audience` → bearer token, valid 24h)
- API: `https://api.revelsystems.com/`

### Token management — `_shared/revelClient.ts`
- `getAccessToken(supabase)` reads the cached token from the single-row `revel_auth_cache` table; if missing/near-expiry, mints a new one and writes it back (encrypted with existing `ENCRYPTION_KEY` / `_shared/encryption.ts`). One token shared across all edge functions and merchants.
- `revelFetch(instance, path, opts)` — authed request helper that attaches `Authorization: Bearer <token>` and `Client-Id: <instance>` (the merchant's Revel subdomain, e.g. `joesdiner` from `joesdiner.revelup.com`).

### Per-restaurant "credential"
Only the **Revel instance subdomain** + **establishment id**. Stored in plaintext (they are non-secret identifiers). The merchant-side authorization is what actually grants access; it surfaces via `GET /external/integrations`.

## 4. Database (new migration)

All tables RLS-enabled, mirroring Toast: view = restaurant members (via `user_restaurants`); insert/update/delete = `owner`/`manager`.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `revel_connections` | 1 row per (restaurant, establishment) | `restaurant_id` FK, `revel_instance`, `establishment_id`, `is_active`, `connection_status`, `initial_sync_done`, `sync_cursor` (timestamptz), `sync_page`, `last_sync_time`, `webhook_active`, `last_error`, `last_error_at`, timestamps. Unique `(restaurant_id, revel_instance, establishment_id)`. **No encrypted per-restaurant secrets.** |
| `revel_orders` | order headers | `revel_order_id`, `establishment_id`, `order_number`, `order_date`, `order_time`, `sold_at` (timestamptz), `total_amount`, `subtotal_amount`, `tax_amount`, `tip_amount`, `discount_amount`, `service_charge_amount`, `payment_status`, `dining_option`, `raw_json`, `synced_at`. Unique `(restaurant_id, revel_order_id)`. |
| `revel_order_items` | line items | `revel_order_id`, `revel_item_id`, `item_name`, `quantity`, `unit_price`, `total_price`, `menu_category`, `modifiers` (jsonb), `is_voided`, `discount_amount`, `raw_json`. Unique `(restaurant_id, revel_order_id, revel_item_id)`. |
| `revel_payments` | payments | `revel_payment_id`, `revel_order_id`, `payment_type`, `amount`, `tip_amount`, `payment_date`, `payment_status`, `raw_json`. Unique `(restaurant_id, revel_payment_id)`. |
| `revel_webhook_events` | idempotency log | `event_id` (`X-Revel-Event-Id`), `event_type`, `restaurant_id`, `processed_at`, `raw_json`. Unique `(restaurant_id, event_id)`. |
| `revel_auth_cache` | shared partner token cache | single row: `access_token_encrypted`, `token_expires_at`, `updated_at`. Service-role only (RLS denies all authenticated users). |

### RPCs (SECURITY DEFINER)
- `revel_sync_financial_breakdown(p_order_id text, p_restaurant_id uuid)` — per-order, splits sale / tax / tip / discount / comp / void into separate `unified_sales` rows using `item_type` / `adjustment_type` (Toast's current best-practice shape). Called by the processor.
- `sync_revel_to_unified_sales(p_restaurant_id uuid, p_start_date date, p_end_date date)` — bulk backfill/reconcile; `INSERT ... SELECT ... ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) DO NOTHING`. Returns synced row count. Called by the adapter and bulk-sync.

## 5. Edge functions

| Function | Auth | Responsibility |
|---|---|---|
| `revel-webhook` | **Public** (no user auth) | Verify **HMAC-SHA1** of the raw body against `REVEL_WEBHOOK_SECRET`. Map `X-Revel-Instance` → `revel_connections` → `restaurant_id`. Idempotency-insert into `revel_webhook_events` (skip if seen). Parse `order.finalized` payload → `processOrder`. **Return 2XX in <10s.** Return `200` even on unknown instance / already-processed to avoid retry storms; log the anomaly. |
| `revel-connect` | User (owner/manager) | Capture Revel instance + establishment; validate the restaurant is authorized via `GET /external/integrations`; upsert `revel_connections`. |
| `revel-test-connection` | User (owner/manager) | Re-validate access on demand (used by the wizard's "Verify" button). |
| `revel-sync-data` | User (owner/manager) | Manual/incremental order pull for a date range; cursor-resumable. |
| `revel-bulk-sync` | Service role (pg_cron) | Initial 90-day backfill in 3-day batches via `sync_cursor`; incremental for the rest; poll `GET /external/message-log` and replay missed webhooks. Round-robin across connections with batch caps (mirror Toast/Shift4). pg_cron schedule offset from existing POS crons. |

Shared modules:
- `_shared/revelClient.ts` — token cache + authed fetch (section 3).
- `_shared/revelOrderProcessor.ts` — `processOrder(supabase, order, restaurantId, revelInstance, establishmentId, options)`, modeled on `toastOrderProcessor.ts`: parse dates, aggregate totals, upsert `revel_orders` / `revel_order_items` / `revel_payments`, then (unless `skipUnifiedSalesSync`) call `revel_sync_financial_breakdown`. **Parses a normalized intermediate shape** so a switch from `OrderAllInOne` to `wide_order` (see risk 8.1) touches only one parse function.

Standard 4-stage shape for authed functions: CORS → Auth (`getUser`) → Permission (`user_restaurants` role check) → Business logic. The webhook receiver skips user auth and instead gates on HMAC signature.

## 6. Frontend

- `src/types/pos.ts` — add `'revel'` to `POSSystemType`.
- `src/hooks/useRevelConnection.tsx` — mirror `useToastConnection`: status query on `revel_connections`, `connect`, `testConnection`, `disconnect`, `triggerManualSync`.
- `src/hooks/adapters/useRevelSalesAdapter.tsx` — implement `POSAdapter` (`fetchSales`, `syncToUnified` via `sync_revel_to_unified_sales`, `getIntegrationStatus`); register in `usePOSIntegrations.tsx`.
- `src/components/pos/RevelSetupWizard.tsx` — **2 steps** (simpler than Toast, no secret pasting): (1) enter Revel URL/subdomain; (2) instructions to authorize EasyShiftHQ in the Revel admin + a "Verify" button hitting `revel-test-connection`.
- `src/components/IntegrationCard.tsx` — add `isRevelIntegration` branch (`id: 'revel-pos'`) + Dialog wrapping the wizard + post-connect sync panel.
- `src/pages/Integrations.tsx` — add catalog entry `id: 'revel-pos'`, category `'Point of Sale'`.
- `src/components/IntegrationLogo.tsx` — add Revel logo mapping.
- Optional `src/components/RevelSync.tsx` — post-connect manual-sync controls (like `SquareSync`/`CloverSync`).

## 7. Rollout — "Coming soon" disabled card

Until Partner Connect credentials exist (no end-to-end testing is possible without them), the Revel card renders **visible but disabled with a "Coming soon" state**. A single gate — `revelEnabled` derived from whether `REVEL_*` config is present (surfaced to the client via a lightweight config check or build-time constant) — controls whether the card is interactive. All code merges normally behind this gate; flipping it on requires only setting the secrets. UI styling follows the Apple/Notion tokens in CLAUDE.md (no direct colors; disabled state via muted tokens).

## 8. Open risks (carry into implementation; confirm with Revel)

1. **`OrderAllInOne` deprecation.** Flagged as unavailable for *new* third-party integrations, yet the webhook docs still reference it. Mitigation: the processor parses a normalized intermediate shape, so if new integrations receive `wide_order` / `wide_order_item` instead, only `revelOrderProcessor`'s parse function changes. **Confirm the actual payload shape with Revel before finalizing the parser.**
2. **Amount units** — dollars vs cents (Toast is dollars; do NOT assume). Confirm from a real payload before trusting totals; centralize any scaling in the processor.
3. **Establishment mapping** — one Revel instance can host multiple establishments; modeled as **1 `revel_connections` row per (restaurant, establishment)**.
4. **Partner Connect gating** — no live testing until credentials arrive; hence the "Coming soon" rollout and heavy reliance on fixture-based tests.

## 9. Testing

- **pgTAP** (`supabase/tests/*.sql`): `revel_sync_financial_breakdown` correctness (sale/tax/tip/discount/comp/void splitting); RLS isolation on `revel_*` tables (cross-restaurant denial; owner/manager write gate).
- **Vitest** (`tests/unit/*.test.ts`): `revelOrderProcessor` parsing against a sample `OrderAllInOne` fixture; **HMAC-SHA1 signature verification** (valid/invalid/tampered body); `useRevelSalesAdapter` mapping.
- Fixtures: sample `order.finalized` payload + headers.

## 10. Prerequisites (business, parallel track)

1. Apply to the Revel Partner program (developer.revelsystems.com / Partner Integrations).
2. Purchase Partner Connect → receive `client_id` / `client_secret` (+ webhook secret after webhook setup).
3. Register the `revel-webhook` receiver URL with Revel per event type.
4. Confirm risks 8.1 (payload format) and 8.2 (amount units) with Revel/partner support.
