# Revel POS Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Revel Systems as a POS integration (sales only) that ingests orders via real-time webhooks + a polling recovery path into the shared `unified_sales` table, following the existing Toast/Square patterns.

**Architecture:** Webhook-first hybrid. Revel's **partner model** means partner-level secrets (`REVEL_CLIENT_ID`/`REVEL_CLIENT_SECRET`/`REVEL_WEBHOOK_SECRET`) live once in Supabase env — not per restaurant. A single public `revel-webhook` receiver verifies HMAC-SHA1 and routes by `X-Revel-Instance` → `revel_connections` → `restaurant_id`, running a shared `revelOrderProcessor` → `revel_sync_financial_breakdown` RPC → `unified_sales`. A `revel-bulk-sync` cron seeds 90-day history and replays missed webhooks via `/external/message-log`. The Integrations card ships **visible but disabled ("Coming soon")** behind a build-time flag until Partner Connect credentials exist.

**Tech Stack:** Supabase (Postgres + RLS + pg_cron + Deno edge functions), React 18 + React Query + TypeScript, Vitest (unit), pgTAP (SQL). Reuses `_shared/encryption.ts` (`ENCRYPTION_KEY`), `_shared/securityEvents.ts`.

**Reference files to mirror (read these before implementing):**
- DB/RPC/RLS: `supabase/migrations/20251116100100_toast_integration.sql`
- Processor: `supabase/functions/_shared/toastOrderProcessor.ts`
- Webhook receiver: `supabase/functions/toast-webhook/index.ts`
- Encryption/logging: `supabase/functions/_shared/encryption.ts`, `supabase/functions/_shared/securityEvents.ts`
- Hook: `src/hooks/useToastConnection.tsx`; Integration-status hook shape: `src/hooks/useToastIntegration.tsx`
- Adapter: `src/hooks/adapters/useToastSalesAdapter.tsx`; registry: `src/hooks/usePOSIntegrations.tsx`
- Wizard: `src/components/pos/ToastSetupWizard.tsx`; wiring: `src/components/IntegrationCard.tsx`, `src/pages/Integrations.tsx`, `src/components/IntegrationLogo.tsx`
- Types: `src/types/pos.ts`; generated: `src/integrations/supabase/types.ts`

**Cross-cutting constants (Revel specifics, used across tasks):**
- Auth URL: `https://authentication.revelup.com/oauth/token` (POST `grant_type=client_credentials`, `client_id`, `client_secret`, `audience=https://api.revelsystems.com`)
- API base: `https://api.revelsystems.com/`
- Per-request headers to Revel: `Authorization: Bearer <token>`, `Client-Id: <instance>`
- Webhook signature: header `X-Revel-Signature` = base64 HMAC-**SHA1** of the raw request body using `REVEL_WEBHOOK_SECRET`
- Webhook routing headers: `X-Revel-Instance`, `X-Revel-Establishment-Id`, `X-Revel-Event-Type`, `X-Revel-Event-Id`
- **Amount units are unconfirmed** (dollars vs cents). All amount reads go through one `toAmount()` helper gated by a single `REVEL_AMOUNTS_IN_CENTS` constant so a flip is one line (spec risk 8.2).
- **Payload shape unconfirmed** (`OrderAllInOne` vs `wide_order`). The processor parses via one `normalizeOrder()` function so a format change touches one place (spec risk 8.1).

---

## Phase 1 — Types & config gate

### Task 1: Add `'revel'` to `POSSystemType` and a build-time feature gate

**Files:**
- Modify: `src/types/pos.ts:3`
- Create: `src/config/revel.ts`

- [ ] **Step 1: Extend the union type**

In `src/types/pos.ts`, change line 3 from:
```typescript
export type POSSystemType = 'square' | 'toast' | 'clover' | 'resy' | 'shift4' | 'manual' | 'manual_upload';
```
to:
```typescript
export type POSSystemType = 'square' | 'toast' | 'clover' | 'resy' | 'shift4' | 'revel' | 'manual' | 'manual_upload';
```

- [ ] **Step 2: Create the feature gate**

Create `src/config/revel.ts`:
```typescript
/**
 * Revel POS integration is gated until EasyShiftHQ's Partner Connect credentials
 * (REVEL_CLIENT_ID / REVEL_CLIENT_SECRET / REVEL_WEBHOOK_SECRET) are provisioned in
 * Supabase and the webhook receiver is registered with Revel.
 *
 * While false, the Integrations card renders visible but disabled ("Coming soon").
 * Flip to true (or wire to an env flag) once credentials are live and tested.
 */
export const REVEL_ENABLED = false;
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no usages of `'revel'` yet beyond the type; adapters added later).

- [ ] **Step 4: Commit**

```bash
git add src/types/pos.ts src/config/revel.ts
git commit -m "feat(revel): add revel POS system type and feature gate"
```

---

## Phase 2 — Database schema, RPCs, and pgTAP tests

### Task 2: Create the Revel tables, indexes, RLS, and sync RPCs migration

**Files:**
- Create: `supabase/migrations/20260706120000_revel_integration.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260706120000_revel_integration.sql`:
```sql
-- =====================================================
-- REVEL POS INTEGRATION DATABASE SCHEMA
-- Partner model: partner-level secrets live in edge env vars, NOT here.
-- Per-restaurant row stores only the Revel instance subdomain + establishment id.
-- Mirrors the Toast integration schema (20251116100100_toast_integration.sql).
-- =====================================================

-- Table: revel_connections (1 row per restaurant+establishment)
CREATE TABLE IF NOT EXISTS public.revel_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_instance TEXT NOT NULL,            -- Client-Id subdomain, e.g. 'joesdiner'
  establishment_id TEXT,                   -- Revel establishment id (nullable until known)
  is_active BOOLEAN NOT NULL DEFAULT true,
  connection_status TEXT NOT NULL DEFAULT 'connected',
  initial_sync_done BOOLEAN NOT NULL DEFAULT false,
  sync_cursor TIMESTAMP WITH TIME ZONE,    -- backfill progress marker
  sync_page INTEGER,                       -- pagination cursor for resumable pulls
  last_sync_time TIMESTAMP WITH TIME ZONE,
  webhook_active BOOLEAN NOT NULL DEFAULT false,
  last_error TEXT,
  last_error_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_instance, establishment_id)
);

-- Table: revel_orders
CREATE TABLE IF NOT EXISTS public.revel_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_order_id TEXT NOT NULL,
  establishment_id TEXT,
  order_number TEXT,
  order_date DATE NOT NULL,
  order_time TIME,
  sold_at TIMESTAMP WITH TIME ZONE,
  total_amount NUMERIC(10, 2),
  subtotal_amount NUMERIC(10, 2),
  tax_amount NUMERIC(10, 2),
  tip_amount NUMERIC(10, 2),
  discount_amount NUMERIC(10, 2),
  service_charge_amount NUMERIC(10, 2),
  payment_status TEXT,
  dining_option TEXT,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_order_id)
);

-- Table: revel_order_items
CREATE TABLE IF NOT EXISTS public.revel_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_order_id_fk UUID NOT NULL REFERENCES public.revel_orders(id) ON DELETE CASCADE,
  revel_order_id TEXT NOT NULL,
  revel_item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  quantity NUMERIC(10, 2) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2),
  total_price NUMERIC(10, 2),
  menu_category TEXT,
  modifiers JSONB,
  is_voided BOOLEAN NOT NULL DEFAULT false,
  discount_amount NUMERIC(10, 2),
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_order_id, revel_item_id)
);

-- Table: revel_payments
CREATE TABLE IF NOT EXISTS public.revel_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  revel_payment_id TEXT NOT NULL,
  revel_order_id TEXT NOT NULL,
  payment_type TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  tip_amount NUMERIC(10, 2) DEFAULT 0,
  payment_date DATE,
  payment_status TEXT,
  raw_json JSONB,
  synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id, revel_payment_id)
);

-- Table: revel_webhook_events (idempotency log)
CREATE TABLE IF NOT EXISTS public.revel_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_json JSONB,
  UNIQUE(restaurant_id, event_id)
);

-- Table: revel_auth_cache (single shared partner bearer token; service-role only)
CREATE TABLE IF NOT EXISTS public.revel_auth_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  access_token_encrypted TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT revel_auth_cache_singleton CHECK (id = 1)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_revel_connections_restaurant ON public.revel_connections(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_revel_connections_instance ON public.revel_connections(revel_instance);
CREATE INDEX IF NOT EXISTS idx_revel_orders_restaurant_date ON public.revel_orders(restaurant_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_revel_orders_revel_order_id ON public.revel_orders(revel_order_id);
CREATE INDEX IF NOT EXISTS idx_revel_order_items_order ON public.revel_order_items(revel_order_id_fk);
CREATE INDEX IF NOT EXISTS idx_revel_order_items_restaurant ON public.revel_order_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_revel_payments_restaurant ON public.revel_payments(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_revel_payments_order ON public.revel_payments(revel_order_id);
CREATE INDEX IF NOT EXISTS idx_revel_webhook_events_restaurant ON public.revel_webhook_events(restaurant_id);

-- Row Level Security
ALTER TABLE public.revel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revel_auth_cache ENABLE ROW LEVEL SECURITY;
-- revel_auth_cache: no policies => only service role can read/write.

CREATE POLICY "Users can view their restaurant Revel connections"
  ON public.revel_connections FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Owners/managers can insert Revel connections"
  ON public.revel_connections FOR INSERT
  WITH CHECK (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid() AND role IN ('owner', 'manager')));

CREATE POLICY "Owners/managers can update Revel connections"
  ON public.revel_connections FOR UPDATE
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid() AND role IN ('owner', 'manager')));

CREATE POLICY "Owners/managers can delete Revel connections"
  ON public.revel_connections FOR DELETE
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid() AND role IN ('owner', 'manager')));

CREATE POLICY "Users can view their restaurant Revel orders"
  ON public.revel_orders FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their restaurant Revel order items"
  ON public.revel_order_items FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their restaurant Revel payments"
  ON public.revel_payments FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

CREATE POLICY "Users can view their restaurant Revel webhook events"
  ON public.revel_webhook_events FOR SELECT
  USING (restaurant_id IN (SELECT restaurant_id FROM public.user_restaurants WHERE user_id = auth.uid()));

-- =====================================================
-- RPC: revel_sync_financial_breakdown(p_order_id, p_restaurant_id)
-- Per-order sync into unified_sales, splitting sale vs tax/tip/discount adjustment rows.
-- Called by the shared processor after upserting order/items/payments.
-- =====================================================
CREATE OR REPLACE FUNCTION public.revel_sync_financial_breakdown(
  p_order_id TEXT,
  p_restaurant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced_count INTEGER := 0;
  v_rows INTEGER := 0;
  v_order public.revel_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order
  FROM public.revel_orders
  WHERE restaurant_id = p_restaurant_id AND revel_order_id = p_order_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- 1) Sale line items (item_type = 'sale')
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at, source
  )
  SELECT
    oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id,
    oi.item_name, oi.quantity, oi.unit_price, oi.total_price,
    v_order.order_date, v_order.order_time, v_order.sold_at, oi.menu_category,
    'sale', oi.raw_json, now(), 'revel_api'
  FROM public.revel_order_items oi
  WHERE oi.restaurant_id = p_restaurant_id
    AND oi.revel_order_id = p_order_id
    AND oi.is_voided = false
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;

  -- 2) Tax adjustment row (item_type = 'tax')
  IF COALESCE(v_order.tax_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at, source
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':tax',
      'Tax', 1, v_order.tax_amount, v_order.tax_amount,
      v_order.order_date, v_order.order_time, v_order.sold_at, 'tax', 'tax', now(), 'revel_api'
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  -- 3) Tip adjustment row (item_type = 'tip')
  IF COALESCE(v_order.tip_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at, source
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':tip',
      'Tip', 1, v_order.tip_amount, v_order.tip_amount,
      v_order.order_date, v_order.order_time, v_order.sold_at, 'tip', 'tip', now(), 'revel_api'
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  -- 4) Discount adjustment row (item_type = 'discount', negative amount)
  IF COALESCE(v_order.discount_amount, 0) <> 0 THEN
    INSERT INTO public.unified_sales (
      restaurant_id, pos_system, external_order_id, external_item_id,
      item_name, quantity, unit_price, total_price,
      sale_date, sale_time, sold_at, item_type, adjustment_type, synced_at, source
    )
    VALUES (
      p_restaurant_id, 'revel', p_order_id, p_order_id || ':discount',
      'Discount', 1, -abs(v_order.discount_amount), -abs(v_order.discount_amount),
      v_order.order_date, v_order.order_time, v_order.sold_at, 'discount', 'discount', now(), 'revel_api'
    )
    ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT; v_synced_count := v_synced_count + v_rows;
  END IF;

  RETURN v_synced_count;
END;
$$;

-- =====================================================
-- RPC: sync_revel_to_unified_sales(p_restaurant_id, p_start_date, p_end_date)
-- Bulk backfill/reconcile used by the adapter and bulk-sync cron.
-- =====================================================
CREATE OR REPLACE FUNCTION public.sync_revel_to_unified_sales(
  p_restaurant_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_synced_count INTEGER := 0;
BEGIN
  INSERT INTO public.unified_sales (
    restaurant_id, pos_system, external_order_id, external_item_id,
    item_name, quantity, unit_price, total_price,
    sale_date, sale_time, sold_at, pos_category, item_type, raw_data, synced_at, source
  )
  SELECT
    oi.restaurant_id, 'revel', oi.revel_order_id, oi.revel_item_id,
    oi.item_name, oi.quantity, oi.unit_price, oi.total_price,
    o.order_date, o.order_time, o.sold_at, oi.menu_category, 'sale', oi.raw_json, now(), 'revel_api'
  FROM public.revel_order_items oi
  INNER JOIN public.revel_orders o ON oi.revel_order_id_fk = o.id
  WHERE oi.restaurant_id = p_restaurant_id
    AND oi.is_voided = false
    AND (p_start_date IS NULL OR o.order_date >= p_start_date)
    AND (p_end_date IS NULL OR o.order_date <= p_end_date)
  ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) DO NOTHING;

  GET DIAGNOSTICS v_synced_count = ROW_COUNT;
  RETURN v_synced_count;
END;
$$;
```

- [ ] **Step 2: Apply the migration locally**

Run: `npm run db:reset`
Expected: completes without error; the `revel_*` tables and both functions are created.

- [ ] **Step 3: Verify tables exist**

Run: `npx supabase db diff --schema public 2>/dev/null | grep -i revel || echo "no diff (tables applied)"`
Expected: no pending diff for `revel_*` (migration is the source of truth).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260706120000_revel_integration.sql
git commit -m "feat(revel): add revel db schema, RLS, and unified_sales sync RPCs"
```

### Task 3: pgTAP tests for the RPC and RLS isolation

**Files:**
- Create: `supabase/tests/revel_integration.sql`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/revel_integration.sql`. **Before writing the fixtures, open an existing `supabase/tests/*.sql` that inserts into `restaurants` and `user_restaurants`** and copy its exact fixture-insert columns + JWT-claim helper — the real `restaurants`/`user_restaurants` tables likely have additional NOT NULL columns (e.g. owner/slug) and your local runner may provide a `tests/helpers` for setting `auth.uid()`. Adjust the inserts below to match; the assertions stay as written.
```sql
BEGIN;
SELECT plan(6);

-- Fixtures: two restaurants (adjust columns to match your restaurants table NOT NULL constraints)
INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Revel Test A'),
  ('22222222-2222-2222-2222-222222222222', 'Revel Test B');

INSERT INTO public.revel_connections (restaurant_id, revel_instance, establishment_id, webhook_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'reveltesta', 'est-1', true);

INSERT INTO public.revel_orders (id, restaurant_id, revel_order_id, order_date, order_time, sold_at,
  total_amount, tax_amount, tip_amount, discount_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'order-1', '2026-07-01', '12:30:00', '2026-07-01T12:30:00Z', 25.00, 2.00, 3.00, 1.00);

INSERT INTO public.revel_order_items (restaurant_id, revel_order_id_fk, revel_order_id, revel_item_id,
  item_name, quantity, unit_price, total_price, is_voided)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 'item-1', 'Burger', 1, 20.00, 20.00, false),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 'item-2', 'Voided Fry', 1, 5.00, 5.00, true);

-- 1) breakdown RPC returns 4 rows: 1 sale + tax + tip + discount (voided item excluded)
SELECT is(
  public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111'),
  4,
  'breakdown inserts sale + tax + tip + discount, excludes voided item'
);

-- 2) sale row present, voided item absent
SELECT is(
  (SELECT count(*)::int FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111' AND pos_system = 'revel' AND item_type = 'sale'),
  1,
  'exactly one non-voided sale row'
);

-- 3) discount row is negative
SELECT ok(
  (SELECT total_price FROM public.unified_sales
   WHERE external_item_id = 'order-1:discount') < 0,
  'discount row stored as negative amount'
);

-- 4) idempotent: second call inserts 0
SELECT is(
  public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111'),
  0,
  'second breakdown call is idempotent'
);

-- 5) bulk sync inserts nothing new after breakdown already ran
SELECT is(
  public.sync_revel_to_unified_sales('11111111-1111-1111-1111-111111111111', NULL, NULL),
  0,
  'bulk sync is idempotent against already-synced sale rows'
);

-- 6) RLS: restaurant B member cannot see restaurant A connections
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999"}';
SELECT is(
  (SELECT count(*)::int FROM public.revel_connections
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'RLS hides connections from non-members'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm run test:db`
Expected: `revel_integration.sql` reports `ok 1..6` all passing. (If your pgTAP runner needs the file registered, follow the same registration the existing `supabase/tests/*.sql` files use.)

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/revel_integration.sql
git commit -m "test(revel): pgTAP for financial breakdown RPC and RLS isolation"
```

---

## Phase 3 — Shared edge modules (signature + client + processor)

### Task 4: `revelSignature.ts` — HMAC-SHA1 verification (cross-runtime, Vitest-testable)

**Files:**
- Create: `supabase/functions/_shared/revelSignature.ts`
- Test: `tests/unit/revelSignature.test.ts`

Uses Web Crypto `crypto.subtle` (available in both Deno and Node ≥20 / Vitest) so it is unit-testable outside Deno.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/revelSignature.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeRevelSignature, verifyRevelSignature } from '../../supabase/functions/_shared/revelSignature';

const SECRET = 'test-webhook-secret';
const BODY = '{"eventType":"order.finalized","order":{"id":"order-1"}}';

describe('revel signature', () => {
  it('computes a stable base64 HMAC-SHA1 for a known body', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    // Recompute must be deterministic and equal
    expect(await computeRevelSignature(BODY, SECRET)).toBe(sig);
    expect(sig).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('verifies a valid signature', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await verifyRevelSignature(BODY, sig, SECRET)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await verifyRevelSignature(BODY + ' ', sig, SECRET)).toBe(false);
  });

  it('rejects a wrong secret', async () => {
    const sig = await computeRevelSignature(BODY, SECRET);
    expect(await verifyRevelSignature(BODY, sig, 'other-secret')).toBe(false);
  });

  it('rejects a null/empty signature safely', async () => {
    expect(await verifyRevelSignature(BODY, null, SECRET)).toBe(false);
    expect(await verifyRevelSignature(BODY, '', SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- revelSignature`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/revelSignature.ts`:
```typescript
/**
 * Revel webhook signature verification.
 * Revel sends `X-Revel-Signature` = base64( HMAC-SHA1( rawBody, sharedSecret ) ).
 * Uses Web Crypto so it runs in both Deno (edge) and Node (Vitest).
 */

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function computeRevelSignature(rawBody: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return bytesToBase64(new Uint8Array(mac));
}

/** Constant-time-ish comparison to avoid early-exit timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function verifyRevelSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string,
): Promise<boolean> {
  if (!signature) return false;
  const expected = await computeRevelSignature(rawBody, secret);
  return safeEqual(signature, expected);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- revelSignature`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/revelSignature.ts tests/unit/revelSignature.test.ts
git commit -m "feat(revel): HMAC-SHA1 webhook signature verification + tests"
```

### Task 5: `revelClient.ts` — partner token cache + authed fetch

**Files:**
- Create: `supabase/functions/_shared/revelClient.ts`

No unit test (network + env bound); it is exercised by the edge functions and verified during the manual sync smoke test once credentials exist.

- [ ] **Step 1: Write the implementation**

Create `supabase/functions/_shared/revelClient.ts`:
```typescript
/**
 * Revel partner API client.
 * Partner credentials (REVEL_CLIENT_ID / REVEL_CLIENT_SECRET) are app-level env secrets.
 * One bearer token (24h) is shared across all merchants and cached in revel_auth_cache.
 */
import { getEncryptionService } from './encryption.ts';

const AUTH_URL = 'https://authentication.revelup.com/oauth/token';
export const REVEL_API_BASE = 'https://api.revelsystems.com';
const AUDIENCE = 'https://api.revelsystems.com';
// Refresh a bit before the 24h expiry to avoid edge-of-window failures.
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

async function mintToken(): Promise<{ token: string; expiresAt: Date }> {
  const clientId = Deno.env.get('REVEL_CLIENT_ID');
  const clientSecret = Deno.env.get('REVEL_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('Revel partner credentials not configured (REVEL_CLIENT_ID/REVEL_CLIENT_SECRET)');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: AUDIENCE,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Revel token request failed: ${res.status}`);
    }
    const data = await res.json();
    const expiresInSec = Number(data.expires_in ?? 86400);
    return { token: data.access_token as string, expiresAt: new Date(Date.now() + expiresInSec * 1000) };
  } finally {
    clearTimeout(timeout);
  }
}

/** Get a valid partner bearer token, using and refreshing the shared cache. */
export async function getAccessToken(supabase: any): Promise<string> {
  const encryption = await getEncryptionService();

  const { data: cached } = await supabase
    .from('revel_auth_cache')
    .select('access_token_encrypted, token_expires_at')
    .eq('id', 1)
    .maybeSingle();

  if (cached?.access_token_encrypted && cached.token_expires_at) {
    const expiresAt = new Date(cached.token_expires_at).getTime();
    if (expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return await encryption.decrypt(cached.access_token_encrypted);
    }
  }

  const { token, expiresAt } = await mintToken();
  const encrypted = await encryption.encrypt(token);
  await supabase.from('revel_auth_cache').upsert({
    id: 1,
    access_token_encrypted: encrypted,
    token_expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });

  return token;
}

/** Authed fetch against the Revel API for a specific merchant instance. */
export async function revelFetch(
  supabase: any,
  instance: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getAccessToken(supabase);
  const url = path.startsWith('http') ? path : `${REVEL_API_BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'Authorization': `Bearer ${token}`,
        'Client-Id': instance,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 2: Typecheck the module (Deno)**

Run: `npx deno check supabase/functions/_shared/revelClient.ts`
Expected: no type errors. (If `deno` is unavailable, skip — validated when functions are served.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/revelClient.ts
git commit -m "feat(revel): partner token cache + authed fetch client"
```

### Task 6: `revelOrderProcessor.ts` — normalize + upsert + breakdown

**Files:**
- Create: `supabase/functions/_shared/revelOrderProcessor.ts`
- Test: `tests/unit/revelOrderProcessor.test.ts`

The processor mirrors `toastOrderProcessor.ts` but isolates all Revel-payload field access inside `normalizeOrder()` (spec risk 8.1) and all currency scaling inside `toAmount()` (spec risk 8.2). `processOrder` takes an injected supabase-like object, so it is unit-testable with a fake.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/revelOrderProcessor.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { normalizeOrder, processOrder } from '../../supabase/functions/_shared/revelOrderProcessor';

// Assumed OrderAllInOne-ish shape (field names are defensive; confirm with Revel per spec risk 8.1).
const SAMPLE = {
  Order: {
    id: 'order-1',
    order_number: 'A-1001',
    created_date: '2026-07-01T12:30:00+0000',
    dining_option: 'DINE_IN',
    subtotal: 20.0,
    tax: 2.0,
    tip: 3.0,
    discount: 1.0,
    service_charge: 0.0,
    total: 24.0,
    payment_status: 'PAID',
  },
  OrderItems: [
    { id: 'item-1', name: 'Burger', quantity: 1, price: 20.0, category: 'Entrees', voided: false },
  ],
  Payments: [
    { id: 'pay-1', type: 'CREDIT', amount: 24.0, tip: 3.0, status: 'CAPTURED' },
  ],
};

function makeFakeSupabase() {
  const calls: Record<string, any[]> = { orders: [], items: [], payments: [], rpc: [] };
  const table = (name: string) => ({
    upsert: async (row: any) => {
      if (name === 'revel_orders') { calls.orders.push(row); return { data: [{ id: 'order-row-uuid' }], error: null }; }
      if (name === 'revel_order_items') { calls.items.push(row); return { data: null, error: null }; }
      if (name === 'revel_payments') { calls.payments.push(row); return { data: null, error: null }; }
      return { data: null, error: null };
    },
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'order-row-uuid' }, error: null }) }) }) }),
  });
  const fake = {
    from: (name: string) => table(name),
    rpc: async (fn: string, args: any) => { calls.rpc.push({ fn, args }); return { data: 1, error: null }; },
    _calls: calls,
  };
  return fake;
}

describe('normalizeOrder', () => {
  it('extracts order id, date, totals, items, payments', () => {
    const n = normalizeOrder(SAMPLE);
    expect(n.orderId).toBe('order-1');
    expect(n.orderDate).toBe('2026-07-01');
    expect(n.totals.taxAmount).toBe(2.0);
    expect(n.totals.tipAmount).toBe(3.0);
    expect(n.items).toHaveLength(1);
    expect(n.items[0].itemName).toBe('Burger');
    expect(n.payments[0].amount).toBe(24.0);
  });
});

describe('processOrder', () => {
  it('upserts order/items/payments and calls the breakdown RPC', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake as any, SAMPLE, 'rest-1', 'reveltesta', 'est-1');
    expect(fake._calls.orders).toHaveLength(1);
    expect(fake._calls.items).toHaveLength(1);
    expect(fake._calls.payments).toHaveLength(1);
    expect(fake._calls.rpc[0]).toEqual({ fn: 'revel_sync_financial_breakdown', args: { p_order_id: 'order-1', p_restaurant_id: 'rest-1' } });
  });

  it('skips the RPC when skipUnifiedSalesSync is set (bulk mode)', async () => {
    const fake = makeFakeSupabase();
    await processOrder(fake as any, SAMPLE, 'rest-1', 'reveltesta', 'est-1', { skipUnifiedSalesSync: true });
    expect(fake._calls.rpc).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- revelOrderProcessor`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/revelOrderProcessor.ts`:
```typescript
/**
 * Shared Revel order processing logic.
 * Used by revel-webhook, revel-sync-data, revel-bulk-sync.
 *
 * All Revel-payload field access is isolated in normalizeOrder() (spec risk 8.1:
 * OrderAllInOne vs wide_order). All currency scaling is isolated in toAmount()
 * (spec risk 8.2: dollars vs cents). Flip REVEL_AMOUNTS_IN_CENTS if Revel returns cents.
 */

export interface ProcessOrderOptions {
  skipUnifiedSalesSync?: boolean;
}

// Set true if a real payload shows integer cents. Default: amounts are decimal dollars.
const REVEL_AMOUNTS_IN_CENTS = false;

function toAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (Number.isNaN(n)) return null;
  return REVEL_AMOUNTS_IN_CENTS ? n / 100 : n;
}

interface NormalizedItem {
  itemId: string;
  itemName: string;
  quantity: number;
  unitPrice: number | null;
  totalPrice: number | null;
  category: string | null;
  isVoided: boolean;
  raw: any;
}

interface NormalizedPayment {
  paymentId: string;
  type: string | null;
  amount: number | null;
  tipAmount: number | null;
  status: string | null;
  raw: any;
}

export interface NormalizedOrder {
  orderId: string;
  orderNumber: string | null;
  orderDate: string;                 // YYYY-MM-DD
  orderTime: string | null;          // HH:MM:SS
  soldAt: string | null;             // ISO timestamp
  diningOption: string | null;
  paymentStatus: string | null;
  totals: {
    totalAmount: number | null;
    subtotalAmount: number | null;
    taxAmount: number | null;
    tipAmount: number | null;
    discountAmount: number | null;
    serviceChargeAmount: number | null;
  };
  items: NormalizedItem[];
  payments: NormalizedPayment[];
}

/** Pull the Order object regardless of envelope shape (OrderAllInOne vs flat). */
function getOrderNode(payload: any): any {
  return payload.Order ?? payload.order ?? payload;
}

function parseDateTime(order: any): { orderDate: string; orderTime: string | null; soldAt: string | null } {
  const rawDate =
    order.created_date ?? order.createdDate ?? order.closed_date ?? order.finalized_date ?? order.date ?? null;
  if (!rawDate) {
    const today = new Date().toISOString();
    return { orderDate: today.split('T')[0], orderTime: null, soldAt: null };
  }
  // Revel timestamps look like '2026-07-01T12:30:00+0000'; Date parses ISO-with-offset.
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) {
    return { orderDate: String(rawDate).split('T')[0], orderTime: null, soldAt: null };
  }
  const iso = d.toISOString();
  return { orderDate: iso.split('T')[0], orderTime: iso.split('T')[1].split('.')[0], soldAt: iso };
}

export function normalizeOrder(payload: any): NormalizedOrder {
  const order = getOrderNode(payload);
  const { orderDate, orderTime, soldAt } = parseDateTime(order);

  const itemsRaw = payload.OrderItems ?? payload.order_items ?? order.items ?? [];
  const paymentsRaw = payload.Payments ?? payload.payments ?? order.payments ?? [];

  const items: NormalizedItem[] = (itemsRaw as any[]).map((it) => ({
    itemId: String(it.id ?? it.uuid ?? it.item_id ?? ''),
    itemName: it.name ?? it.display_name ?? it.item_name ?? 'Unknown Item',
    quantity: Number(it.quantity ?? it.qty ?? 1),
    unitPrice: toAmount(it.price ?? it.unit_price ?? it.amount),
    totalPrice: toAmount(it.total ?? it.total_price ?? it.price),
    category: it.category ?? it.category_name ?? it.menu_category ?? null,
    isVoided: Boolean(it.voided ?? it.is_voided ?? false),
    raw: it,
  }));

  const payments: NormalizedPayment[] = (paymentsRaw as any[]).map((p) => ({
    paymentId: String(p.id ?? p.uuid ?? p.payment_id ?? ''),
    type: p.type ?? p.payment_type ?? p.tender_type ?? null,
    amount: toAmount(p.amount ?? p.total),
    tipAmount: toAmount(p.tip ?? p.tip_amount),
    status: p.status ?? p.payment_status ?? null,
    raw: p,
  }));

  return {
    orderId: String(order.id ?? order.uuid ?? order.order_id ?? ''),
    orderNumber: order.order_number ?? order.orderNumber ?? order.number ?? null,
    orderDate,
    orderTime,
    soldAt,
    diningOption: order.dining_option ?? order.diningOption ?? order.order_type ?? null,
    paymentStatus: order.payment_status ?? order.paymentStatus ?? null,
    totals: {
      totalAmount: toAmount(order.total ?? order.total_amount),
      subtotalAmount: toAmount(order.subtotal ?? order.subtotal_amount),
      taxAmount: toAmount(order.tax ?? order.tax_amount),
      tipAmount: toAmount(order.tip ?? order.tip_amount),
      discountAmount: toAmount(order.discount ?? order.discount_amount),
      serviceChargeAmount: toAmount(order.service_charge ?? order.service_charge_amount),
    },
    items,
    payments,
  };
}

async function upsertOrder(supabase: any, n: NormalizedOrder, restaurantId: string, establishmentId: string | null, raw: any): Promise<string> {
  const { data, error } = await supabase.from('revel_orders').upsert({
    restaurant_id: restaurantId,
    revel_order_id: n.orderId,
    establishment_id: establishmentId,
    order_number: n.orderNumber,
    order_date: n.orderDate,
    order_time: n.orderTime,
    sold_at: n.soldAt,
    total_amount: n.totals.totalAmount,
    subtotal_amount: n.totals.subtotalAmount,
    tax_amount: n.totals.taxAmount,
    tip_amount: n.totals.tipAmount,
    discount_amount: n.totals.discountAmount,
    service_charge_amount: n.totals.serviceChargeAmount,
    payment_status: n.paymentStatus,
    dining_option: n.diningOption,
    raw_json: raw,
    synced_at: new Date().toISOString(),
  }, { onConflict: 'restaurant_id,revel_order_id' }).select('id').maybeSingle();

  if (error) throw new Error(`Failed to upsert revel order: ${error.message}`);
  return data?.id;
}

async function upsertItems(supabase: any, n: NormalizedOrder, orderRowId: string, restaurantId: string): Promise<void> {
  for (const item of n.items) {
    const { error } = await supabase.from('revel_order_items').upsert({
      restaurant_id: restaurantId,
      revel_order_id_fk: orderRowId,
      revel_order_id: n.orderId,
      revel_item_id: item.itemId,
      item_name: item.itemName,
      quantity: item.quantity,
      unit_price: item.unitPrice,
      total_price: item.totalPrice,
      menu_category: item.category,
      modifiers: item.raw?.modifiers ?? null,
      is_voided: item.isVoided,
      raw_json: item.raw,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,revel_order_id,revel_item_id' });
    if (error) throw new Error(`Failed to upsert revel order item: ${error.message}`);
  }
}

async function upsertPayments(supabase: any, n: NormalizedOrder, restaurantId: string): Promise<void> {
  for (const p of n.payments) {
    const { error } = await supabase.from('revel_payments').upsert({
      restaurant_id: restaurantId,
      revel_payment_id: p.paymentId,
      revel_order_id: n.orderId,
      payment_type: p.type,
      amount: p.amount ?? 0,
      tip_amount: p.tipAmount,
      payment_date: n.orderDate,
      payment_status: p.status,
      raw_json: p.raw,
      synced_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,revel_payment_id' });
    if (error) throw new Error(`Failed to upsert revel payment: ${error.message}`);
  }
}

export async function processOrder(
  supabase: any,
  payload: any,
  restaurantId: string,
  revelInstance: string,
  establishmentId: string | null,
  options: ProcessOrderOptions = {},
): Promise<void> {
  const n = normalizeOrder(payload);
  if (!n.orderId) throw new Error('Revel order payload missing order id');

  const orderRowId = await upsertOrder(supabase, n, restaurantId, establishmentId, payload);
  await upsertItems(supabase, n, orderRowId, restaurantId);
  await upsertPayments(supabase, n, restaurantId);

  if (!options.skipUnifiedSalesSync) {
    const { error } = await supabase.rpc('revel_sync_financial_breakdown', {
      p_order_id: n.orderId,
      p_restaurant_id: restaurantId,
    });
    if (error) throw new Error(`Failed to sync financial breakdown: ${error.message}`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- revelOrderProcessor`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/revelOrderProcessor.ts tests/unit/revelOrderProcessor.test.ts
git commit -m "feat(revel): shared order processor with normalize + breakdown + tests"
```

---

## Phase 4 — Edge functions

### Task 7: `revel-webhook` receiver

**Files:**
- Create: `supabase/functions/revel-webhook/index.ts`

- [ ] **Step 1: Write the implementation**

Create `supabase/functions/revel-webhook/index.ts`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyRevelSignature } from "../_shared/revelSignature.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-revel-signature, x-revel-instance, x-revel-establishment-id, x-revel-event-type, x-revel-event-id',
};

// Always ack 2XX for non-actionable cases so Revel does not retry-storm (spec: return 200, log).
function ack(body = 'OK', status = 200) {
  return new Response(body, { headers: corsHeaders, status });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-revel-signature');
    const instance = req.headers.get('x-revel-instance');
    const establishmentId = req.headers.get('x-revel-establishment-id');
    const eventType = req.headers.get('x-revel-event-type') ?? 'unknown';
    const eventId = req.headers.get('x-revel-event-id');

    const webhookSecret = Deno.env.get('REVEL_WEBHOOK_SECRET');
    if (!webhookSecret) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_SECRET_NOT_CONFIGURED');
      return ack('Webhook not configured', 200);
    }

    // MANDATORY signature check
    const valid = await verifyRevelSignature(rawBody, signature, webhookSecret);
    if (!valid) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_SIGNATURE_FAILED', undefined, undefined, { instance, eventType });
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!instance) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_MISSING_INSTANCE');
      return ack('Missing instance', 200);
    }

    // Route instance -> restaurant
    const { data: connection } = await supabase
      .from('revel_connections')
      .select('*')
      .eq('revel_instance', instance)
      .eq('is_active', true)
      .maybeSingle();

    if (!connection) {
      await logSecurityEvent(supabase, 'REVEL_WEBHOOK_NO_CONNECTION', undefined, undefined, { instance });
      return ack('No connection', 200); // ack to avoid retries; merchant not onboarded here
    }

    // Idempotency
    if (eventId) {
      const { data: existing } = await supabase
        .from('revel_webhook_events')
        .select('id')
        .eq('restaurant_id', connection.restaurant_id)
        .eq('event_id', eventId)
        .maybeSingle();
      if (existing) return ack();
    }

    const payload = JSON.parse(rawBody);

    if (eventId) {
      await supabase.from('revel_webhook_events').insert({
        restaurant_id: connection.restaurant_id,
        event_id: eventId,
        event_type: eventType,
        raw_json: payload,
      });
    }

    // Only order.finalized carries sales; ignore other event types for v1.
    if (eventType === 'order.finalized' || payload.Order || payload.order) {
      await processOrder(
        supabase,
        payload,
        connection.restaurant_id,
        instance,
        establishmentId ?? connection.establishment_id ?? null,
      );
    }

    await logSecurityEvent(supabase, 'REVEL_WEBHOOK_PROCESSED', undefined, connection.restaurant_id, { eventType, eventId });
    return ack();
  } catch (error: any) {
    // 500 => Revel will retry per its backoff schedule (spec: 60/300/900/900).
    await logSecurityEvent(supabase, 'REVEL_WEBHOOK_ERROR', undefined, undefined, { message: error?.message });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
```

- [ ] **Step 2: Add to config as a public (no-JWT) function**

Edit `supabase/config.toml` — add (mirroring how other webhook receivers like `toast-webhook`/`square-webhooks` are declared; find that block and copy it):
```toml
[functions.revel-webhook]
verify_jwt = false
```

- [ ] **Step 3: Serve locally to confirm it boots**

Run: `npx supabase functions serve revel-webhook --no-verify-jwt` (Ctrl-C after it prints "Serving").
Expected: boots with no import/type errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/revel-webhook/index.ts supabase/config.toml
git commit -m "feat(revel): public webhook receiver with HMAC verify + idempotency"
```

### Task 8: `revel-connect` and `revel-test-connection`

**Files:**
- Create: `supabase/functions/revel-connect/index.ts`
- Create: `supabase/functions/revel-test-connection/index.ts`

Both follow the standard CORS → Auth (`getUser`) → Permission (`user_restaurants` owner/manager) → business logic shape.

- [ ] **Step 1: Write `revel-connect`**

Create `supabase/functions/revel-connect/index.ts`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { logSecurityEvent } from "../_shared/securityEvents.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { restaurantId, revelInstance, establishmentId } = await req.json();
    if (!restaurantId || !revelInstance) return json({ error: 'restaurantId and revelInstance are required' }, 400);

    // Permission: owner/manager on this restaurant
    const { data: role } = await userClient
      .from('user_restaurants')
      .select('role')
      .eq('restaurant_id', restaurantId)
      .eq('user_id', user.id)
      .in('role', ['owner', 'manager'])
      .maybeSingle();
    if (!role) return json({ error: 'Forbidden' }, 403);

    const service = createClient(supabaseUrl, serviceKey);

    // Normalize instance: strip protocol + '.revelup.com' if user pasted a full URL.
    const instance = String(revelInstance)
      .replace(/^https?:\/\//, '')
      .replace(/\.revelup\.com\/?.*$/, '')
      .replace(/\/.*$/, '')
      .trim()
      .toLowerCase();

    // Validate we actually have partner access to this instance.
    const res = await revelFetch(service, instance, '/external/integrations');
    if (!res.ok) {
      await logSecurityEvent(service, 'REVEL_CONNECT_VALIDATION_FAILED', user.id, restaurantId, { instance, status: res.status });
      return json({ error: `Could not verify Revel access for "${instance}". Ensure you authorized EasyShiftHQ in your Revel account.` }, 400);
    }

    const { error: upsertError } = await service.from('revel_connections').upsert({
      restaurant_id: restaurantId,
      revel_instance: instance,
      establishment_id: establishmentId ?? null,
      is_active: true,
      connection_status: 'connected',
      webhook_active: true,
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,revel_instance,establishment_id' });

    if (upsertError) return json({ error: upsertError.message }, 500);

    await logSecurityEvent(service, 'REVEL_CONNECTED', user.id, restaurantId, { instance });
    return json({ success: true, instance });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
```

- [ ] **Step 2: Write `revel-test-connection`**

Create `supabase/functions/revel-test-connection/index.ts`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { restaurantId } = await req.json();
    if (!restaurantId) return json({ error: 'restaurantId is required' }, 400);

    // Read connection via RLS (confirms membership + existence)
    const { data: connection } = await userClient
      .from('revel_connections')
      .select('revel_instance, establishment_id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!connection) return json({ error: 'No Revel connection found' }, 404);

    const service = createClient(supabaseUrl, serviceKey);
    const res = await revelFetch(service, connection.revel_instance, '/external/integrations');
    if (!res.ok) {
      return json({ success: false, error: `Revel access check failed (${res.status})` });
    }

    return json({ success: true, instance: connection.revel_instance });
  } catch (error: any) {
    return json({ success: false, error: error.message }, 200);
  }
});
```

- [ ] **Step 3: Serve both to confirm they boot**

Run: `npx supabase functions serve revel-connect` then (separately) `npx supabase functions serve revel-test-connection` (Ctrl-C after "Serving").
Expected: both boot with no import/type errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/revel-connect/index.ts supabase/functions/revel-test-connection/index.ts
git commit -m "feat(revel): connect + test-connection edge functions"
```

### Task 9: `revel-sync-data` (user-triggered incremental pull)

**Files:**
- Create: `supabase/functions/revel-sync-data/index.ts`

Pulls finalized orders for a date range from the Revel order resource and processes them. Uses `skipUnifiedSalesSync: true` during the loop, then one bulk RPC at the end (mirrors Toast's bulk approach to respect CPU limits).

- [ ] **Step 1: Write the implementation**

Create `supabase/functions/revel-sync-data/index.ts`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// NOTE: the exact order-list endpoint + query params are confirmed against Revel's data
// dictionary (wide_order) during first live sync. Isolated here so only this URL changes.
function ordersPath(startDate: string, endDate: string): string {
  // Revel filtering uses double-underscore operators (spec/FAQ): created_date__gte / __lte.
  const params = new URLSearchParams({
    'created_date__gte': `${startDate}T00:00:00`,
    'created_date__lte': `${endDate}T23:59:59`,
    'limit': '100',
  });
  return `/resources/Order/?${params.toString()}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const { restaurantId, startDate, endDate } = await req.json();
    if (!restaurantId) return json({ error: 'restaurantId is required' }, 400);

    const { data: connection } = await userClient
      .from('revel_connections')
      .select('revel_instance, establishment_id')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .maybeSingle();
    if (!connection) return json({ error: 'No Revel connection found' }, 404);

    const service = createClient(supabaseUrl, serviceKey);

    const end = endDate || new Date().toISOString().split('T')[0];
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const res = await revelFetch(service, connection.revel_instance, ordersPath(start, end));
    if (!res.ok) {
      await service.from('revel_connections')
        .update({ last_error: `sync failed: ${res.status}`, last_error_at: new Date().toISOString() })
        .eq('restaurant_id', restaurantId);
      return json({ error: `Revel order fetch failed (${res.status})` }, 502);
    }

    const body = await res.json();
    const orders: any[] = body.objects ?? body.results ?? body.orders ?? (Array.isArray(body) ? body : []);

    let processed = 0;
    for (const order of orders) {
      try {
        await processOrder(service, order, restaurantId, connection.revel_instance, connection.establishment_id ?? null, { skipUnifiedSalesSync: true });
        processed++;
      } catch (_e) { /* skip a bad order, continue */ }
    }

    const { data: synced } = await service.rpc('sync_revel_to_unified_sales', {
      p_restaurant_id: restaurantId,
      p_start_date: start,
      p_end_date: end,
    });

    await service.from('revel_connections')
      .update({ last_sync_time: new Date().toISOString(), last_error: null, last_error_at: null })
      .eq('restaurant_id', restaurantId);

    return json({ success: true, ordersProcessed: processed, salesSynced: Number(synced) || 0 });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
```

- [ ] **Step 2: Serve to confirm it boots**

Run: `npx supabase functions serve revel-sync-data` (Ctrl-C after "Serving").
Expected: boots clean.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/revel-sync-data/index.ts
git commit -m "feat(revel): user-triggered incremental order sync"
```

### Task 10: `revel-bulk-sync` cron + schedule

**Files:**
- Create: `supabase/functions/revel-bulk-sync/index.ts`
- Create: `supabase/migrations/20260706120100_revel_bulk_sync_cron.sql`

- [ ] **Step 1: Write the bulk-sync function**

Create `supabase/functions/revel-bulk-sync/index.ts`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { revelFetch } from "../_shared/revelClient.ts";
import { processOrder } from "../_shared/revelOrderProcessor.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_RESTAURANTS_PER_RUN = 5;
const BACKFILL_DAYS = 90;
const BATCH_DAYS = 3;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function ordersPath(startDate: string, endDate: string): string {
  const params = new URLSearchParams({
    'created_date__gte': `${startDate}T00:00:00`,
    'created_date__lte': `${endDate}T23:59:59`,
    'limit': '200',
  });
  return `/resources/Order/?${params.toString()}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const service = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    // Round-robin: oldest last_sync_time first
    const { data: connections } = await service
      .from('revel_connections')
      .select('*')
      .eq('is_active', true)
      .order('last_sync_time', { ascending: true, nullsFirst: true })
      .limit(MAX_RESTAURANTS_PER_RUN);

    let totalProcessed = 0;

    for (const conn of connections ?? []) {
      // Determine the window: initial backfill vs incremental
      let start: string;
      let end: string;
      const today = new Date();

      if (!conn.initial_sync_done) {
        const cursor = conn.sync_cursor ? new Date(conn.sync_cursor) : new Date(today.getTime() - BACKFILL_DAYS * 86400000);
        start = cursor.toISOString().split('T')[0];
        end = new Date(cursor.getTime() + BATCH_DAYS * 86400000).toISOString().split('T')[0];
      } else {
        start = new Date(today.getTime() - 2 * 86400000).toISOString().split('T')[0]; // 48h incremental
        end = today.toISOString().split('T')[0];
      }

      try {
        const res = await revelFetch(service, conn.revel_instance, ordersPath(start, end));
        if (res.ok) {
          const body = await res.json();
          const orders: any[] = body.objects ?? body.results ?? body.orders ?? (Array.isArray(body) ? body : []);
          for (const order of orders) {
            try {
              await processOrder(service, order, conn.restaurant_id, conn.revel_instance, conn.establishment_id ?? null, { skipUnifiedSalesSync: true });
              totalProcessed++;
            } catch (_e) { /* continue */ }
          }
          await service.rpc('sync_revel_to_unified_sales', { p_restaurant_id: conn.restaurant_id, p_start_date: start, p_end_date: end });
        }

        // Advance cursor / mark backfill complete
        const update: Record<string, unknown> = { last_sync_time: new Date().toISOString(), last_error: null, last_error_at: null };
        if (!conn.initial_sync_done) {
          const nextCursor = new Date(new Date(end).getTime() + 86400000);
          if (nextCursor >= today) {
            update.initial_sync_done = true;
            update.sync_cursor = null;
          } else {
            update.sync_cursor = nextCursor.toISOString();
          }
        }
        await service.from('revel_connections').update(update).eq('id', conn.id);
      } catch (e: any) {
        await service.from('revel_connections')
          .update({ last_error: e?.message ?? 'bulk sync error', last_error_at: new Date().toISOString() })
          .eq('id', conn.id);
      }

      // Gentle pacing between merchants (rate-limit friendliness)
      await new Promise((r) => setTimeout(r, 2000));
    }

    return json({ success: true, restaurants: connections?.length ?? 0, ordersProcessed: totalProcessed });
  } catch (error: any) {
    return json({ error: error.message }, 500);
  }
});
```

- [ ] **Step 2: Declare the function as no-JWT in config**

Edit `supabase/config.toml` — add:
```toml
[functions.revel-bulk-sync]
verify_jwt = false
```

- [ ] **Step 3: Write the cron schedule migration**

Create `supabase/migrations/20260706120100_revel_bulk_sync_cron.sql`. **Before writing, open the existing Toast cron migration `supabase/migrations/20260127000000_toast_sync_improvements.sql` and copy its exact `cron.schedule(...) / net.http_post(...)` block** (same vault key lookup and function-URL construction), changing only the job name, the schedule, and the function name:
```sql
-- Schedule revel-bulk-sync every 6 hours, offset from other POS crons.
-- Mirror the net.http_post block from 20260127000000_toast_sync_improvements.sql exactly,
-- substituting the values below.
--   job name:      'revel-bulk-sync'
--   schedule:      '20 */6 * * *'   -- :20 past, every 6h (offset from toast/shift4)
--   function path: '/functions/v1/revel-bulk-sync'
-- Keep the same service-role Authorization header and Content-Type the Toast job uses.
SELECT cron.schedule(
  'revel-bulk-sync',
  '20 */6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/revel-bulk-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```
> If the Toast cron migration uses different vault secret names or a helper, use those instead — the goal is byte-for-byte parity with the working Toast job except for the three substituted values.

- [ ] **Step 4: Apply and verify the cron registers**

Run: `npm run db:reset`
Then: `npx supabase db reset` already ran migrations; verify with the same query the Toast migration comment suggests, or: connect and `SELECT jobname FROM cron.job WHERE jobname = 'revel-bulk-sync';`
Expected: one row.

- [ ] **Step 5: Serve to confirm the function boots**

Run: `npx supabase functions serve revel-bulk-sync --no-verify-jwt` (Ctrl-C after "Serving").
Expected: boots clean.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/revel-bulk-sync/index.ts supabase/config.toml supabase/migrations/20260706120100_revel_bulk_sync_cron.sql
git commit -m "feat(revel): bulk-sync cron with 90-day backfill + incremental"
```

---

## Phase 5 — Frontend

### Task 11: `useRevelConnection` and `useRevelIntegration` hooks

**Files:**
- Create: `src/hooks/useRevelConnection.tsx`
- Create: `src/hooks/useRevelIntegration.tsx`

`useRevelIntegration` is the thin status hook consumed by `Integrations.tsx` and the adapter (mirrors `useToastIntegration`'s `{ isConnected, connection }` shape). `useRevelConnection` carries the actions.

- [ ] **Step 1: Write `useRevelConnection`**

Create `src/hooks/useRevelConnection.tsx`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export type RevelConnection = {
  id: string;
  restaurant_id: string;
  revel_instance: string;
  establishment_id: string | null;
  is_active: boolean;
  connection_status: string;
  initial_sync_done: boolean;
  last_sync_time: string | null;
  webhook_active: boolean;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export function useRevelConnection(restaurantId?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: connection, isLoading: loading } = useQuery({
    queryKey: ['revel-connection', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const { data, error } = await supabase
        .from('revel_connections' as any)
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      return (data as unknown as RevelConnection) ?? null;
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  const isConnected = !!connection;

  async function checkConnectionStatus(id: string): Promise<RevelConnection | null> {
    if (!id) return null;
    const { data } = await supabase
      .from('revel_connections' as any)
      .select('*')
      .eq('restaurant_id', id)
      .eq('is_active', true)
      .maybeSingle();
    return (data as unknown as RevelConnection) ?? null;
  }

  async function connect(id: string, revelInstance: string, establishmentId?: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('revel-connect', {
      body: { restaurantId: id, revelInstance, establishmentId },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    queryClient.invalidateQueries({ queryKey: ['revel-connection', id] });
    return data;
  }

  async function testConnection(id: string): Promise<Record<string, unknown>> {
    const { data, error } = await supabase.functions.invoke('revel-test-connection', {
      body: { restaurantId: id },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function triggerManualSync(id: string, options?: { startDate?: string; endDate?: string }): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase.functions.invoke('revel-sync-data', {
      body: { restaurantId: id, ...(options?.startDate && { startDate: options.startDate }), ...(options?.endDate && { endDate: options.endDate }) },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!options?.startDate) {
      toast({ title: 'Sync initiated', description: `Processed ${data?.ordersProcessed || 0} orders` });
    }
    queryClient.invalidateQueries({ queryKey: ['revel-connection', id] });
    return data;
  }

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('revel_connections' as any).update({ is_active: false }).eq('restaurant_id', id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['revel-connection', id] });
      toast({ title: 'Disconnected', description: 'Revel connection has been disabled' });
    },
    onError: () => {
      toast({ title: 'Error', description: 'Failed to disconnect from Revel', variant: 'destructive' });
    },
  });

  async function disconnectRevel(id: string): Promise<void> {
    return disconnectMutation.mutateAsync(id);
  }

  return { isConnected, connection, loading, connect, testConnection, triggerManualSync, disconnectRevel, checkConnectionStatus };
}
```

- [ ] **Step 2: Write `useRevelIntegration` (thin status hook)**

Create `src/hooks/useRevelIntegration.tsx`:
```typescript
import { useRevelConnection, RevelConnection } from '@/hooks/useRevelConnection';

/** Thin status hook mirroring useToastIntegration's { isConnected, connection } shape. */
export function useRevelIntegration(restaurantId: string | null): {
  isConnected: boolean;
  connection: RevelConnection | null;
} {
  const { isConnected, connection } = useRevelConnection(restaurantId);
  return { isConnected, connection: connection ?? null };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Casts `'revel_connections' as any` are used because generated types aren't regenerated until Task 15; remove the casts in Task 15.)

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useRevelConnection.tsx src/hooks/useRevelIntegration.tsx
git commit -m "feat(revel): connection + integration-status hooks"
```

### Task 12: `useRevelSalesAdapter` and registry wiring

**Files:**
- Create: `src/hooks/adapters/useRevelSalesAdapter.tsx`
- Modify: `src/hooks/usePOSIntegrations.tsx`

- [ ] **Step 1: Write the adapter**

Create `src/hooks/adapters/useRevelSalesAdapter.tsx`:
```typescript
import { useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRevelIntegration } from '@/hooks/useRevelIntegration';
import { POSAdapter, POSIntegrationStatus, UnifiedSaleItem } from '@/types/pos';
import { useToast } from '@/hooks/use-toast';

export const useRevelSalesAdapter = (restaurantId: string | null): POSAdapter => {
  const { isConnected, connection } = useRevelIntegration(restaurantId);
  const { toast } = useToast();

  const fetchSales = useCallback(async (rid: string, startDate?: string, endDate?: string): Promise<UnifiedSaleItem[]> => {
    if (!isConnected) return [];
    try {
      let query = supabase
        .from('unified_sales')
        .select('*')
        .eq('restaurant_id', rid)
        .eq('pos_system', 'revel')
        .order('sale_date', { ascending: false });
      if (startDate) query = query.gte('sale_date', startDate);
      if (endDate) query = query.lte('sale_date', endDate);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((sale) => ({
        id: sale.id,
        restaurantId: sale.restaurant_id,
        posSystem: 'revel',
        externalOrderId: sale.external_order_id,
        externalItemId: sale.external_item_id,
        itemName: sale.item_name,
        quantity: sale.quantity,
        unitPrice: sale.unit_price,
        totalPrice: sale.total_price,
        saleDate: sale.sale_date,
        saleTime: sale.sale_time,
        posCategory: sale.pos_category,
        rawData: sale.raw_data,
        syncedAt: sale.synced_at,
        createdAt: sale.created_at,
      }));
    } catch (error) {
      console.error('Error fetching Revel sales:', error);
      return [];
    }
  }, [isConnected]);

  const syncToUnified = useCallback(async (rid: string, startDate?: string, endDate?: string): Promise<number> => {
    if (!isConnected) return 0;
    try {
      const syncEnd = endDate || new Date().toISOString().split('T')[0];
      const syncStart = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const { data, error } = await supabase.rpc('sync_revel_to_unified_sales' as any, {
        p_restaurant_id: rid,
        p_start_date: syncStart,
        p_end_date: syncEnd,
      });
      if (error) throw error;
      const syncedCount = Number(data) || 0;
      if (syncedCount > 0) {
        toast({ title: 'Sales synced', description: `${syncedCount} new sales records synced from Revel.` });
      }
      return syncedCount;
    } catch (error: any) {
      console.error('Error syncing Revel sales:', error);
      toast({ title: 'Error syncing sales', description: error.message, variant: 'destructive' });
      return 0;
    }
  }, [isConnected, toast]);

  const getIntegrationStatus = useCallback((): POSIntegrationStatus => ({
    system: 'revel',
    isConnected,
    isConfigured: !!connection,
    connectionId: connection?.id,
    lastSyncAt: connection?.last_sync_time || connection?.created_at,
  }), [isConnected, connection]);

  return useMemo(() => ({
    system: 'revel' as const,
    isConnected,
    fetchSales,
    syncToUnified,
    getIntegrationStatus,
  }), [isConnected, fetchSales, syncToUnified, getIntegrationStatus]);
};
```

- [ ] **Step 2: Register in `usePOSIntegrations.tsx`**

In `src/hooks/usePOSIntegrations.tsx`:

Add the import after line 5 (`useShift4SalesAdapter`):
```typescript
import { useRevelSalesAdapter } from './adapters/useRevelSalesAdapter';
```

Add the adapter init after line 17 (`const shift4Adapter = ...`):
```typescript
  const revelAdapter = useRevelSalesAdapter(restaurantId);
```

In the `adapterMap` object (currently lines 34-42), add `revel` next to `shift4`:
```typescript
      shift4: shift4Adapter,
      revel: revelAdapter,
```

Add `revelAdapter.isConnected` to the effect dependency array (currently lines 51-58), after `shift4Adapter.isConnected`:
```typescript
    shift4Adapter.isConnected,
    revelAdapter.isConnected,
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/adapters/useRevelSalesAdapter.tsx src/hooks/usePOSIntegrations.tsx
git commit -m "feat(revel): unified_sales adapter + registry wiring"
```

### Task 13: `RevelSetupWizard` (2-step, no secret pasting)

**Files:**
- Create: `src/components/pos/RevelSetupWizard.tsx`

- [ ] **Step 1: Write the wizard**

Create `src/components/pos/RevelSetupWizard.tsx`:
```typescript
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, Loader2, ExternalLink } from 'lucide-react';
import { useRevelConnection } from '@/hooks/useRevelConnection';

interface RevelSetupWizardProps {
  restaurantId: string;
  onComplete: () => void;
}

type SetupStep = 'instance' | 'complete';

export const RevelSetupWizard = ({ restaurantId, onComplete }: RevelSetupWizardProps) => {
  const [currentStep, setCurrentStep] = useState<SetupStep>('instance');
  const [instance, setInstance] = useState('');
  const [establishmentId, setEstablishmentId] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { connect, testConnection } = useRevelConnection();

  const handleConnect = async () => {
    if (!instance.trim()) {
      toast({ title: 'Missing information', description: 'Enter your Revel URL or subdomain', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      await connect(restaurantId, instance.trim(), establishmentId.trim() || undefined);
      const result = await testConnection(restaurantId);
      if (result.success) {
        setCurrentStep('complete');
      } else {
        throw new Error(String(result.error) || 'Connection test failed');
      }
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to connect to Revel',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl">Revel POS Setup</CardTitle>
        <CardDescription>Connect your Revel POS to sync sales into your unified dashboard</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {currentStep === 'instance' && (
          <div className="space-y-6">
            <Alert>
              <AlertDescription>
                <div className="space-y-2">
                  <p className="font-semibold">Before you connect:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Log in to your Revel account and authorize <strong>EasyShiftHQ</strong> as an integration partner</li>
                    <li>Copy your Revel URL — it looks like <code className="bg-muted px-1 rounded">yourname.revelup.com</code></li>
                    <li>Paste the URL (or just the <strong>yourname</strong> part) below</li>
                  </ol>
                  <a
                    href="https://support.revelsystems.com/s/partner-integrations"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-1 text-sm"
                  >
                    Revel partner integrations help <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </AlertDescription>
            </Alert>

            <div className="space-y-4">
              <div>
                <Label htmlFor="revel-instance">Revel URL or subdomain</Label>
                <Input
                  id="revel-instance"
                  value={instance}
                  onChange={(e) => setInstance(e.target.value)}
                  placeholder="yourname.revelup.com"
                />
              </div>
              <div>
                <Label htmlFor="revel-establishment">Establishment ID (optional)</Label>
                <Input
                  id="revel-establishment"
                  value={establishmentId}
                  onChange={(e) => setEstablishmentId(e.target.value)}
                  placeholder="Leave blank if you have a single establishment"
                />
              </div>
              <Button onClick={handleConnect} disabled={loading || !instance.trim()} className="w-full">
                {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Connecting...</>) : 'Connect & Verify'}
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'complete' && (
          <div className="space-y-6 text-center py-8">
            <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-12 h-12 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-2xl font-semibold mb-2">Setup Complete!</h3>
              <p className="text-muted-foreground">Revel is connected. Sales will sync in real time via webhooks.</p>
            </div>
            <Alert>
              <AlertDescription>
                <p className="font-semibold mb-2">How syncing works:</p>
                <ul className="list-disc list-inside space-y-1 text-sm text-left">
                  <li>New orders arrive in real time as Revel finalizes them</li>
                  <li>Historical data (last 90 days) imports on the first background sync</li>
                  <li>A scheduled job reconciles any missed events every 6 hours</li>
                </ul>
              </AlertDescription>
            </Alert>
            <Button onClick={onComplete} className="w-full">Go to Dashboard</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/pos/RevelSetupWizard.tsx
git commit -m "feat(revel): 2-step setup wizard"
```

### Task 14: Wire Revel into the Integrations page (visible + "Coming soon" disabled)

**Files:**
- Modify: `src/components/IntegrationLogo.tsx`
- Modify: `src/pages/Integrations.tsx`
- Modify: `src/components/IntegrationCard.tsx`

- [ ] **Step 1: Add the Revel logo emoji fallback**

In `src/components/IntegrationLogo.tsx`, add to the `emojiMap` object (after the `'toast-pos': '🍞',` line):
```typescript
  'revel-pos': '🔔',
```

- [ ] **Step 2: Add `comingSoon` to the Integration interface + card gate**

In `src/components/IntegrationCard.tsx`:

Add `comingSoon` to the `Integration` interface (after `connected: boolean;`, line 34):
```typescript
  comingSoon?: boolean;
```

Add the Revel imports after line 13 (`useFocusConnection`):
```typescript
import { useRevelConnection } from '@/hooks/useRevelConnection';
import { RevelSetupWizard } from '@/components/pos/RevelSetupWizard';
import { RevelSync } from '@/components/RevelSync';
```

Add state after line 48 (`showFocusSetup`):
```typescript
  const [showRevelSetup, setShowRevelSetup] = useState(false);
```

Add the hook after line 68 (`focusConnection`):
```typescript
  const revelConnection = useRevelConnection(restaurantId);
```

Add the id flag after line 76 (`isFocusIntegration`):
```typescript
  const isRevelIntegration = integration.id === 'revel-pos';
```

Add to `getActuallyConnected` (after the focus line, before `return integration.connected;`):
```typescript
    if (isRevelIntegration) return revelConnection.isConnected;
```

Add to `getActuallyConnecting` (after the focus line, before `return isConnecting;`):
```typescript
    if (isRevelIntegration) return revelConnection.loading;
```

At the very top of `handleConnect` (before the `isSquareIntegration` block, line 102), short-circuit the coming-soon state:
```typescript
    if (integration.comingSoon) {
      toast({
        title: 'Coming soon',
        description: `${integration.name} isn't available to connect yet. We'll enable it shortly.`,
      });
      return;
    }
```

Add the Revel branch in `handleConnect` (after the `isFocusIntegration` block, before the "coming soon" fallback):
```typescript
    if (isRevelIntegration) {
      setShowRevelSetup(true);
      return;
    }
```

Add to `handleDisconnect` (after the `isFocusIntegration` block):
```typescript
    if (isRevelIntegration) {
      await revelConnection.disconnectRevel(restaurantId);
      return;
    }
```

Add to `getConnectionDateLabel` (after the focus block, before `return 'Last sync: 2 hours ago';`):
```typescript
    if (isRevelIntegration && revelConnection.connection) {
      const ts = revelConnection.connection.last_sync_time ?? revelConnection.connection.created_at;
      return `Last sync: ${new Date(ts).toLocaleDateString()}`;
    }
```

Disable the Connect button for coming-soon integrations. Replace the connect `<Button>` block (currently lines 311-318) with:
```typescript
            <Button
              className="w-full bg-primary hover:bg-primary/90 transition-all hover:shadow-md"
              onClick={handleConnect}
              disabled={actuallyConnecting || integration.comingSoon}
            >
              <Plug className="h-4 w-4 mr-2" />
              {integration.comingSoon ? 'Coming soon' : actuallyConnecting ? 'Connecting...' : 'Connect'}
            </Button>
```

Add the Revel Sync panel next to the others (after the Focus Sync block, ~line 365):
```typescript
            {/* Revel Sync Component */}
            {isRevelIntegration && (
              <RevelSync restaurantId={restaurantId} />
            )}
```

Add the Revel setup dialog after the Focus dialog (before the closing `</Card>`, ~line 414):
```typescript
      {/* Revel POS Setup Wizard Dialog */}
      <Dialog open={showRevelSetup} onOpenChange={setShowRevelSetup}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <RevelSetupWizard
            restaurantId={restaurantId}
            onComplete={() => {
              setShowRevelSetup(false);
              revelConnection.checkConnectionStatus(restaurantId);
            }}
          />
        </DialogContent>
      </Dialog>
```

- [ ] **Step 3: Create the `RevelSync` panel**

Create `src/components/RevelSync.tsx`:
```typescript
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2 } from 'lucide-react';
import { useRevelConnection } from '@/hooks/useRevelConnection';

interface RevelSyncProps {
  restaurantId: string;
}

export const RevelSync = ({ restaurantId }: RevelSyncProps) => {
  const [syncing, setSyncing] = useState(false);
  const { triggerManualSync } = useRevelConnection(restaurantId);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await triggerManualSync(restaurantId);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Button variant="outline" size="sm" className="w-full" onClick={handleSync} disabled={syncing}>
      {syncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
      {syncing ? 'Syncing...' : 'Sync now'}
    </Button>
  );
};
```

- [ ] **Step 4: Add the Revel catalog entry (gated) in `Integrations.tsx`**

In `src/pages/Integrations.tsx`:

Add the import after line 12 (`useFocusConnection`):
```typescript
import { useRevelIntegration } from '@/hooks/useRevelIntegration';
import { REVEL_ENABLED } from '@/config/revel';
```

Add the connection status after line 25 (`focusConnected`):
```typescript
  const { isConnected: revelConnected } = useRevelIntegration(selectedRestaurant?.restaurant_id || null);
```

Add the catalog entry to the `integrations` array (after the `focus-pos` object, before `sling-scheduling`):
```typescript
    {
      id: 'revel-pos',
      name: 'Revel POS',
      description: 'Sync sales in real time from Revel POS via webhooks',
      category: 'Point of Sale',
      logo: '🔔',
      connected: revelConnected,
      comingSoon: !REVEL_ENABLED,
      features: ['Real-time Sales', 'Order Items', 'Payments', 'Webhook-first']
    },
```

Add `revelConnected` to the `integrations` `useMemo` dependency array (line 122):
```typescript
  ], [toastConnected, squareConnected, cloverConnected, shift4Connected, focusConnected, revelConnected, slingConnected]);
```

> Note: the `integrations` array items are structurally typed; adding the optional `comingSoon` field on one entry is fine since `IntegrationCard`'s `Integration` interface now declares it optional.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Verify in the browser (preview)**

Start the dev server (preview_start), open the Integrations page, select a restaurant. Confirm:
- A "Revel POS" card appears under Point of Sale.
- Its button reads **"Coming soon"** and is disabled.
- `preview_console_logs` shows no errors.

Capture a screenshot for the PR.

- [ ] **Step 7: Commit**

```bash
git add src/components/IntegrationLogo.tsx src/pages/Integrations.tsx src/components/IntegrationCard.tsx src/components/RevelSync.tsx
git commit -m "feat(revel): integrations card (visible, coming-soon disabled) + sync panel"
```

---

## Phase 6 — Type generation & final verification

### Task 15: Regenerate Supabase types and remove `as any` casts

**Files:**
- Modify: `src/integrations/supabase/types.ts` (generated)
- Modify: `src/hooks/useRevelConnection.tsx`, `src/hooks/adapters/useRevelSalesAdapter.tsx`

- [ ] **Step 1: Regenerate types**

Regenerate the generated Supabase types so `revel_*` tables and the two RPCs are known to the client. Use the project's `/sync-types` skill, or the Supabase MCP `generate_typescript_types` tool, writing to `src/integrations/supabase/types.ts`.

- [ ] **Step 2: Remove the temporary casts**

In `src/hooks/useRevelConnection.tsx`, remove the `'revel_connections' as any` casts → `'revel_connections'` and drop the `as unknown as RevelConnection` casts where the generated row type now suffices.
In `src/hooks/adapters/useRevelSalesAdapter.tsx`, remove `'sync_revel_to_unified_sales' as any` → `'sync_revel_to_unified_sales'`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS with the casts removed.

- [ ] **Step 4: Commit**

```bash
git add src/integrations/supabase/types.ts src/hooks/useRevelConnection.tsx src/hooks/adapters/useRevelSalesAdapter.tsx
git commit -m "chore(revel): regenerate supabase types, drop temporary casts"
```

### Task 16: Full test + lint + build gate

- [ ] **Step 1: Run the unit suite**

Run: `npm run test`
Expected: all tests pass, including `revelSignature` and `revelOrderProcessor`.

- [ ] **Step 2: Run db tests**

Run: `npm run test:db`
Expected: `revel_integration.sql` passes.

- [ ] **Step 3: Lint, typecheck, build**

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit any lint fixes, then open the PR**

Follow the repo's PR workflow. In the PR description, include:
- The three **carried risks** (payload shape, amount units, establishment mapping) as explicit reviewer call-outs.
- The launch checklist below.
- The Integrations "Coming soon" screenshot from Task 14.

---

## Launch checklist (post-merge, when Partner Connect lands)

1. Set Supabase secrets: `REVEL_CLIENT_ID`, `REVEL_CLIENT_SECRET`, `REVEL_WEBHOOK_SECRET`.
2. Register the `revel-webhook` function URL with Revel for the `order.finalized` (and `ping`) event types.
3. Send Revel's `ping` test event → confirm 200 + a `REVEL_WEBHOOK_PROCESSED`/signature-valid log.
4. Confirm one real `order.finalized` payload: check `revel_orders`/`revel_order_items`/`unified_sales` rows, and **verify amount units** (flip `REVEL_AMOUNTS_IN_CENTS` if cents) and **field names** in `normalizeOrder` (adjust if `wide_order` shape differs).
5. Connect one pilot restaurant; let `revel-bulk-sync` complete the 90-day backfill (watch `initial_sync_done`).
6. Flip `REVEL_ENABLED = true` in `src/config/revel.ts` → the card becomes connectable. Ship.

---

## Notes for the implementer

- **DRY:** the order-list URL builder is duplicated in `revel-sync-data` and `revel-bulk-sync`. If a third caller appears, extract it into `_shared/revelClient.ts`; two copies is acceptable for now.
- **YAGNI:** no labor/inventory tables, no menu catalog table (v1 is sales only per the spec).
- **Amounts & payload shape:** never hand-edit amounts or field access outside `toAmount()` / `normalizeOrder()` — those two functions are the single points of change for spec risks 8.1 and 8.2.
- **CPU limits:** bulk paths always use `skipUnifiedSalesSync: true` + one RPC at the end, mirroring Toast, to stay under the ~10s edge CPU budget.
