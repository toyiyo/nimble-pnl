# Integration Patterns & Best Practices

> **Purpose**: This document outlines the patterns, conventions, and best practices used for integrating with third-party services in EasyShiftHQ. These patterns ensure security, reliability, and maintainability while keeping the system real-time.

---

## 📋 Table of Contents

- [Bank Connections](#bank-connections)
- [POS System Integrations](#pos-system-integrations)
- [Large Data Import Pattern](#large-data-import-pattern)
- [AI & Machine Learning](#ai--machine-learning)
- [Invoicing & Payments](#invoicing--payments)
- [Subscription Billing](#subscription-billing)
- [Supabase Usage Patterns](#supabase-usage-patterns)
- [Edge Functions Architecture](#edge-functions-architecture)
- [Security Best Practices](#security-best-practices)
- [Performance & Real-Time Considerations](#performance--real-time-considerations)

---

## 🏦 Bank Connections

### Overview

We use **Stripe Financial Connections** for secure bank account linking and transaction synchronization. This provides OAuth-based bank connections with automatic transaction imports.

### Connection Pattern

**Hook**: `useStripeFinancialConnections.tsx`

```typescript
// 1. Create Financial Connections session
const { createFinancialConnectionsSession } = useStripeFinancialConnections(restaurantId);
const session = await createFinancialConnectionsSession();

// 2. User connects bank via Stripe UI (client-side)
// Stripe handles OAuth flow, MFA, and credentials securely

// 3. Verify connection after user completes flow
await verifyConnectionSession(session.sessionId);

// 4. Sync transactions from connected bank
await syncTransactions(bankId);
```

### Edge Functions

1. **`stripe-financial-connections-session`** - Creates Stripe Financial Connections session
   - **Input**: `{ restaurantId }`
   - **Output**: `{ clientSecret, sessionId }`
   - **Security**: Creates Stripe customer with restaurant metadata

2. **`stripe-verify-connection-session`** - Processes newly linked accounts
   - **Input**: `{ sessionId, restaurantId }`
   - **Output**: `{ success, accountsProcessed, message }`
   - **Logic**: Stores connected bank details, sets up account balances

3. **`stripe-sync-transactions`** - Syncs transactions for a bank account
   - **Input**: `{ bankId }`
   - **Output**: `{ synced, skipped, message }`
   - **Features**: Bulk import, automatic AI categorization, duplicate detection

4. **`stripe-refresh-balance`** - Updates account balance
   - **Input**: `{ bankId }`
   - **Output**: Updated balance data
   - **Frequency**: On-demand or periodic

5. **`stripe-disconnect-bank`** - Disconnects bank and optionally deletes data
   - **Input**: `{ bankId, deleteData }`
   - **Output**: `{ background, message }`
   - **Features**: Background deletion for large datasets

### Webhook Handler

**Function**: `stripe-financial-connections-webhook`

- **Purpose**: Handles real-time events from Stripe (account connected, disconnected, etc.)
- **Security**: Verifies webhook signature using `STRIPE_FINANCIAL_CONNECTIONS_WEBHOOK_SECRET`
- **Idempotency**: Tracks processed events in `stripe_events` table to prevent duplicate processing
- **Events Handled**:
  - `financial_connections.account.created`
  - `financial_connections.account.disconnected`
  - `financial_connections.account.refresh.failed`

### Data Flow

```
User → Create Session → Stripe OAuth UI → Bank Authentication
  ↓
Webhook (account.created) → Store connection → Initial balance
  ↓
Sync Transactions → Fetch from Stripe → AI Categorization → Store in DB
  ↓
Real-time Subscription → Update UI
```

### Best Practices

✅ **DO:**
- Always verify webhook signatures
- Use service role for Edge Functions (bypasses RLS)
- Store bank credentials in Stripe, not in our database
- Implement idempotency for webhook processing
- Use background jobs for bulk operations (>1000 transactions)
- Invalidate React Query cache after sync operations
- Handle disconnection gracefully with user confirmation

❌ **DON'T:**
- Store sensitive bank credentials in Supabase
- Process webhooks without signature verification
- Sync transactions on every page load (use manual trigger)
- Block UI during long sync operations
- Skip error handling for API failures

### Security Considerations

1. **Credentials**: Never stored locally - always in Stripe's secure vault
2. **Webhook Verification**: Always verify `stripe-signature` header
3. **RLS Bypass**: Edge Functions use service role - validate permissions in code
4. **Customer Metadata**: Restaurant ID stored in Stripe customer metadata for mapping
5. **HTTPS Only**: All webhook endpoints require HTTPS

---

## 🛒 POS System Integrations

### Supported Systems

1. **Square** (primary)
2. **Clover** (secondary)
3. **Toast** (Standard API — no webhooks)
4. **Shift4** (planned)

### Integration Pattern: Adapter Architecture

We use the **Adapter Pattern** to provide a unified interface for multiple POS systems. This allows the application to work with any POS system without knowing implementation details.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│         Application (POS-agnostic)                  │
│              useUnifiedSales.tsx                    │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
┌──────────────────┐        ┌──────────────────┐
│  Square Adapter  │        │  Clover Adapter  │
│  (implements     │        │  (implements     │
│   POSAdapter)    │        │   POSAdapter)    │
└────────┬─────────┘        └────────┬─────────┘
         │                           │
         ▼                           ▼
┌──────────────────┐        ┌──────────────────┐
│  Square OAuth &  │        │  Clover OAuth &  │
│  Webhooks        │        │  Webhooks        │
└──────────────────┘        └──────────────────┘
```

### POSAdapter Interface

**Location**: `src/types/pos.ts`

```typescript
interface POSAdapter {
  system: POSSystemType;           // 'square' | 'clover'
  isConnected: boolean;
  fetchSales: (restaurantId: string, startDate?: string, endDate?: string) => Promise<UnifiedSaleItem[]>;
  syncToUnified: (restaurantId: string) => Promise<number>;
  getIntegrationStatus: () => POSIntegrationStatus;
}
```

### Implementation Example: Square

**Hook**: `useSquareIntegration.tsx`
**Adapter**: `useSquareSalesAdapter.tsx`

```typescript
// 1. Connection Management (useSquareIntegration)
const { isConnected, connectSquare, disconnectSquare } = useSquareIntegration(restaurantId);

// OAuth Flow
await connectSquare(); 
// → Redirects to Square OAuth
// → Square calls back to /square-oauth callback
// → Store connection details and access token (encrypted)

// 2. Data Synchronization (Adapter)
const adapter = useSquareSalesAdapter(restaurantId);
const syncedCount = await adapter.syncToUnified(restaurantId);
// → Calls RPC: sync_square_to_unified_sales
// → Transforms Square data to unified format
// → Stores in unified_sales table

// 3. Fetching Unified Data
const sales = await adapter.fetchSales(restaurantId, startDate, endDate);
```

### Edge Functions

#### Square

1. **`square-oauth`** - Handles OAuth flow
   - **Actions**: `authorize`, `callback`
   - **Flow**: Generate auth URL → User authorizes → Store encrypted tokens
   - **Security**: Tokens encrypted with AES-GCM using `ENCRYPTION_KEY`

2. **`square-sync-data`** - Manual data synchronization
   - **Syncs**: Orders, items, inventory, categories
   - **Features**: Incremental sync, duplicate detection
   - **Rate Limiting**: Respects Square API limits

3. **`square-periodic-sync`** - Scheduled background sync
   - **Trigger**: Supabase cron job
   - **Frequency**: Configurable (default: hourly)
   - **Scope**: All active connections

4. **`square-webhooks`** - Real-time event handling
   - **Events**: `order.created`, `order.updated`, `inventory.count.updated`
   - **Security**: Verifies HMAC signature
   - **Processing**: Updates unified_sales table immediately

5. **`square-webhook-register`** - Registers webhook subscriptions
   - **Purpose**: Ensures Square sends events to our endpoint
   - **Subscriptions**: Orders, inventory, catalog

#### Clover

Similar pattern with `clover-oauth`, `clover-sync-data`, `clover-webhooks`, etc.

#### Toast (Standard API)

Toast uses a fundamentally different integration pattern from Square/Clover because Toast's Standard API **does not support webhooks** or restaurant auto-discovery. This changes the architecture significantly.

**Key differences from Square/Clover:**

| Aspect | Square/Clover | Toast |
|--------|---------------|-------|
| Sync trigger | Webhook + polling | Polling only (cron) |
| Restaurant discovery | API-based | Manual (user provides GUID) |
| Auth type | Standard OAuth | Machine Client OAuth |
| Amount format | Cents (÷ 100) | Dollars (use as-is) |
| Item name field | `name` | `displayName` |
| Order totals | Order-level | Check-level (aggregate `order.checks[]`) |

**Database tables (raw data):**

```
toast_connections    → OAuth credentials (encrypted), sync state
toast_orders         → Order headers (one per order)
toast_order_items    → Line items (unique: restaurant_id, toast_item_guid, toast_order_guid)
toast_payments       → Payment records (unique: restaurant_id, toast_payment_guid, toast_order_guid)
```

**Edge Functions:**

1. **`toast-oauth`** — Machine Client OAuth flow
   - **Auth type**: `TOAST_MACHINE_CLIENT` access type
   - **Credentials**: `clientId` + `clientSecret` per restaurant
   - **Token storage**: Encrypted in `toast_connections.access_token`
   - **No refresh tokens**: Toast machine client tokens don't expire (re-auth if revoked)

2. **`toast-sync-data`** — Manual sync (user-triggered)
   - **Batch size**: 10 orders per request (Edge Function CPU limits)
   - **Returns**: `{ ordersSynced, syncComplete, hasMore, progress }`
   - **Idempotent**: Uses upserts on all tables
   - **Skips unified_sales sync**: Sets `skipUnifiedSalesSync: true` during bulk import (cron handles it)

3. **`toast-bulk-sync`** — Scheduled sync (cron, every 6 hours)
   - **Round-robin**: Processes max 5 restaurants per run, ordered by `last_sync_time`
   - **Per-restaurant limit**: 200 orders max
   - **Rate limiting**: 2-second delay between restaurants
   - **Incremental**: Fetches orders from `last_sync_time - 25 hours` to now
   - **Why 25 hours?** Toast data can be corrected within 24 hours; 1-hour buffer prevents boundary misses

**Sync pipeline (raw → unified):**

```
Toast API → processOrder() → toast_orders / toast_order_items / toast_payments
                                          ↓ (every 5 min via pg_cron)
                              sync_toast_to_unified_sales()
                                          ↓
                                    unified_sales
                                          ↓ (per-row trigger, disabled during bulk sync)
                              auto_categorize_pos_sale → applies categorization_rules
                              trigger_unified_sales_aggregation → daily_sales_summary
```

**Two cron jobs:**

| Job | Schedule | Purpose |
|-----|----------|---------|
| `toast-bulk-sync` | Every 6h | Fetch from Toast API → raw tables |
| `toast-unified-sales-sync` | Every 5min | Aggregate raw tables → `unified_sales` |

**Separation rationale:** API fetch is slow and rate-limited (6h interval sufficient). Aggregation is fast SQL and needs to be near-real-time for dashboard accuracy (5min interval).

**Performance patterns (apply to all POS imports):**

1. **GUC-based trigger bypass during bulk sync**: Instead of `ALTER TABLE DISABLE TRIGGER` (which takes a `ShareRowExclusiveLock` and blocks concurrent writers), use a transaction-local GUC flag:
   ```sql
   -- In sync function (SECURITY DEFINER)
   PERFORM set_config('app.skip_unified_sales_triggers', 'true', true);
   -- ... bulk operations ...
   PERFORM set_config('app.skip_unified_sales_triggers', 'false', true);

   -- In trigger function
   IF current_setting('app.skip_unified_sales_triggers', true) = 'true' THEN
     RETURN NEW;  -- Skip trigger logic
   END IF;
   ```
   **Why GUC over ALTER TABLE?** (a) No table lock — concurrent single-row inserts (real-time sync, UI) proceed normally. (b) Transaction-scoped — auto-resets on commit/rollback, no cleanup needed. (c) No DDL privileges required by the calling function.

2. **Batch categorization after bulk upsert**: Instead of per-row trigger categorization during bulk sync (N × expensive rule matching), do a single set-based UPDATE after all rows are inserted:
   ```sql
   UPDATE unified_sales us SET
     category_id = cr.category_id,
     is_categorized = true
   FROM categorization_rules cr
   WHERE us.restaurant_id = p_restaurant_id
     AND us.is_categorized = false
     AND us.item_type = 'sale'
     AND cr.restaurant_id = p_restaurant_id
     AND cr.is_active = true AND cr.auto_apply = true
     AND matches_pos_sale_rule(cr.id, ...)
   ```
   **Why batch?** Per-row trigger fires `matches_pos_sale_rule()` for every rule × every row. Batch categorization does it once, joining all uncategorized rows with all active rules in a single pass.

3. **Partial index for rule lookups**:
   ```sql
   CREATE INDEX idx_cr_pos_active_auto
     ON categorization_rules (restaurant_id, priority DESC, created_at ASC)
     WHERE is_active = true AND auto_apply = true AND applies_to IN ('pos_sales', 'both');
   ```

4. **SET search_path on SECURITY DEFINER functions**: Prevents search_path injection attacks. Always add `SET search_path = public` to functions that run with elevated privileges.

5. **Date-range scoping in cron**: The cron should call the date-range overload instead of the full-table version. Only re-process orders within the sync window (last 25 hours).

**Key Files:**

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/toastOrderProcessor.ts` | Order parsing + DB upserts |
| `supabase/functions/toast-sync-data/index.ts` | Manual sync endpoint |
| `supabase/functions/toast-bulk-sync/index.ts` | Cron-triggered API fetch |
| `src/hooks/useToastConnection.ts` | Frontend connection hook |
| `src/components/pos/ToastSetupWizard.tsx` | Setup wizard UI |
| `supabase/migrations/*_fix_toast_sync_timeout.sql` | GUC bypass + batch categorization |
| `supabase/migrations/*_toast_unified_sales_cron.sql` | Cron job definitions |

### Webhook Security Pattern

**All POS webhooks follow this pattern:**

```typescript
// 1. Get raw body (needed for signature verification)
const rawBody = await req.text();
const signature = req.headers.get('x-[system]-signature');

// 2. Verify signature
const notificationUrl = `${SUPABASE_URL}/functions/v1/[system]-webhooks`;
const signaturePayload = notificationUrl + rawBody;
const computedSignature = createHmac('sha256', WEBHOOK_SECRET)
  .update(signaturePayload)
  .digest('base64');

if (signature !== computedSignature) {
  console.error('Invalid signature');
  // Log but don't reject (allows debugging in dev)
}

// 3. Parse and process
const webhookData = JSON.parse(rawBody);
// ... handle event
```

### Unified Sales Table

All POS systems write to a single `unified_sales` table with this structure:

```sql
unified_sales (
  id,
  restaurant_id,
  pos_system,              -- 'square' | 'clover' | 'toast'
  external_order_id,       -- POS-specific order ID
  external_item_id,        -- POS-specific item ID
  item_name,
  quantity,
  unit_price,
  total_price,
  sale_date,
  sale_time,
  pos_category,
  raw_data,                -- JSONB with full POS data
  synced_at,
  created_at
)
```

### Best Practices

✅ **DO:**
- Use adapter pattern for new POS integrations
- Store all data in unified format
- Preserve raw POS data in `raw_data` JSONB field
- Implement webhook + polling (dual synchronization)
- Encrypt OAuth tokens using shared encryption service
- Handle token refresh automatically
- Support multiple restaurants per merchant

❌ **DON'T:**
- Create POS-specific tables for sales data
- Store unencrypted access tokens
- Poll API excessively (respect rate limits)
- Process duplicate webhooks (check idempotency)
- Hardcode POS-specific logic in UI components

### Adding a New POS System

1. Create integration hook: `use[POS]Integration.tsx`
2. Create adapter hook: `use[POS]SalesAdapter.tsx` (implements `POSAdapter`)
3. Create Edge Functions:
   - `[pos]-oauth/index.ts`
   - `[pos]-sync-data/index.ts`
   - `[pos]-webhooks/index.ts`
4. Create RPC function: `sync_[pos]_to_unified_sales()`
5. Update `POSSystemType` in `types/pos.ts`
6. Add to `useUnifiedSales.tsx` adapter selection

---

## 📦 Large Data Import Pattern

### Overview

When importing large transaction sets from POS systems (initial syncs, historical backfills), Supabase Edge Functions have CPU limits that can interrupt long-running operations:

- **Soft limit**: 2 seconds CPU time per request
- **Hard limit**: 50ms per request at scale
- **Wall clock**: 400 seconds max

This pattern ensures reliable data import even when CPU limits are reached.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  executeSyncLoop() - Retry loop with small batches      │   │
│   │  • MAX_RETRIES = 3 per request                          │   │
│   │  • RETRY_DELAY_MS = 2000 (CPU recovery)                 │   │
│   │  • Accumulates orders across requests                   │   │
│   └─────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Multiple small requests
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Edge Function                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  toast-sync-data (or [pos]-sync-data)                   │   │
│   │  • MAX_ORDERS_PER_REQUEST = 10                          │   │
│   │  • Returns hasMore flag when more data exists           │   │
│   │  • Idempotent upserts (safe to retry)                   │   │
│   └─────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Inserts raw data
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Database                                    │
│   ┌─────────────────┐         ┌─────────────────────────────┐   │
│   │  toast_orders   │  ───►   │     unified_sales           │   │
│   │  (raw data)     │  cron   │  (aggregated for dashboard) │   │
│   └─────────────────┘         └─────────────────────────────┘   │
│                                         ▲                        │
│   ┌─────────────────────────────────────┴───────────────────┐   │
│   │  pg_cron: sync_all_toast_to_unified_sales               │   │
│   │  • Runs every 5 minutes                                 │   │
│   │  • Aggregates raw orders → unified_sales                │   │
│   │  • Uses date-range filtering for efficiency             │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Frontend Sync Loop with Retry

**Location**: `src/components/ToastSync.tsx` (or `[POS]Sync.tsx`)

```typescript
async function executeSyncLoop(options?: { startDate?: string; endDate?: string }): Promise<{
  totalOrders: number;
  allErrors: (string | SyncError)[];
  complete: boolean;
}> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000;  // Helps CPU limit recovery
  const BATCH_DELAY_MS = 500;

  const allErrors: (string | SyncError)[] = [];
  let totalOrders = 0;
  let complete = false;
  let consecutiveFailures = 0;

  while (!complete) {
    try {
      const data = await triggerManualSync(restaurantId, options);

      if (data?.ordersSynced === undefined) {
        break;
      }

      // Success - reset failure counter
      consecutiveFailures = 0;
      totalOrders += data.ordersSynced;
      setTotalOrdersSynced(totalOrders);
      setSyncProgress(data.progress || 100);

      if (data.errors?.length) {
        allErrors.push(...data.errors);
      }

      complete = data.syncComplete !== false;

      if (!complete) {
        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      }
    } catch (error) {
      consecutiveFailures++;
      const errorMessage = error instanceof Error ? error.message : 'Request failed';

      console.warn(`Sync request failed (attempt ${consecutiveFailures}/${MAX_RETRIES}):`, errorMessage);

      if (consecutiveFailures >= MAX_RETRIES) {
        allErrors.push({ message: `Sync interrupted after ${MAX_RETRIES} retries: ${errorMessage}` });
        break;
      }

      // Wait before retrying (helps with CPU limit recovery)
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  return { totalOrders, allErrors, complete };
}
```

**Key Features**:
- Accumulates orders across multiple requests
- Retries on transient failures (CPU limits, network errors)
- Resets retry counter on success
- 2-second delay between retries for CPU recovery

#### 2. Edge Function with Small Batches

**Location**: `supabase/functions/toast-sync-data/index.ts` (or `[pos]-sync-data`)

```typescript
// Conservative batch sizes for Supabase Edge Function CPU limits
const MAX_ORDERS_PER_REQUEST = 10;
const PAGE_SIZE = 10;
const BATCH_DAYS = 1;  // For initial sync, process 1 day at a time

interface OrderFetchResult {
  ordersProcessed: number;
  errors: Array<{ orderGuid: string; message: string }>;
  hasMore: boolean;  // True if we stopped due to maxOrders limit
}

// Response includes hasMore flag for frontend loop
return jsonResponse({
  ordersSynced: totalOrders,
  errors: allErrors,
  syncComplete: !result.hasMore,  // Frontend continues if false
  progress: syncComplete ? 100 : 50
});
```

**Key Features**:
- Small batch sizes (10 orders per request)
- Returns `hasMore` flag when more data exists
- Uses `syncComplete` to signal frontend to continue or stop
- Progress indicator (50% when more batches needed)

#### 3. Idempotent Database Operations

**Location**: `supabase/functions/_shared/toastOrderProcessor.ts`

```typescript
// Use UPSERT for idempotent operations (safe to retry)
const { error: upsertError } = await supabase
  .from('toast_orders')
  .upsert({
    restaurant_id: restaurantId,
    toast_order_guid: order.guid,
    // ... other fields
  }, {
    onConflict: 'restaurant_id,toast_order_guid'  // Unique constraint
  });
```

**Key Features**:
- Upsert with `ON CONFLICT DO UPDATE`
- Safe to run multiple times
- No duplicate data even if request retried

#### 4. Cron Job for Aggregation

**Location**: `supabase/migrations/20260127151647_toast_unified_sales_cron.sql`

```sql
-- Function to sync all active connections to unified_sales
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
BEGIN
  -- Process last 7 days to catch any missed orders
  FOR v_connection IN
    SELECT tc.restaurant_id
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      SELECT sync_toast_to_unified_sales(
        v_connection.restaurant_id,
        (CURRENT_DATE - INTERVAL '7 days')::date,
        (CURRENT_DATE + INTERVAL '1 day')::date
      ) INTO v_synced;

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Schedule every 5 minutes
SELECT cron.schedule(
  'toast-unified-sales-sync',
  '*/5 * * * *',
  $$SELECT sync_all_toast_to_unified_sales()$$
);
```

**Key Features**:
- Runs every 5 minutes
- Uses each connection's `last_sync_time` with 25-hour buffer (not a hardcoded window)
- Falls back to 90-day window for connections without a `last_sync_time`
- Continues on error (doesn't fail entire batch)
- Uses date-range filtering for efficiency

### Data Flow

```
User clicks "Sync"
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend: executeSyncLoop()                                │
│  Loop while !complete:                                      │
│    1. Call edge function (max 10 orders)                    │
│    2. If error, retry up to 3 times with 2s delay           │
│    3. Accumulate ordersSynced                               │
│    4. Check syncComplete flag                               │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (multiple requests)
┌─────────────────────────────────────────────────────────────┐
│  Edge Function: toast-sync-data                             │
│  1. Fetch 10 orders from POS API                            │
│  2. Upsert into toast_orders (raw data)                     │
│  3. Return { ordersSynced, syncComplete, hasMore }          │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (raw data saved)
┌─────────────────────────────────────────────────────────────┐
│  Database: toast_orders                                     │
│  (Orders are safe even if aggregation fails)                │
└─────────────────────────────────────────────────────────────┘
       │
       ▼ (every 5 minutes)
┌─────────────────────────────────────────────────────────────┐
│  pg_cron: sync_all_toast_to_unified_sales                   │
│  1. Get all active connections                              │
│  2. For each: aggregate toast_orders → unified_sales        │
│  3. Use date-range (last 7 days) for efficiency             │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│  Database: unified_sales                                    │
│  (Aggregated data for dashboard)                            │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Checklist

When implementing this pattern for a new POS integration:

- [ ] **Edge Function**
  - [ ] Set `MAX_ORDERS_PER_REQUEST = 10`
  - [ ] Set `PAGE_SIZE = 10`
  - [ ] Return `hasMore` flag when batch limit reached
  - [ ] Return `syncComplete: !hasMore` in response
  - [ ] Use upserts with `onConflict` for idempotency

- [ ] **Frontend Component**
  - [ ] Implement retry loop with `MAX_RETRIES = 3`
  - [ ] Use `RETRY_DELAY_MS = 2000` for CPU recovery
  - [ ] Accumulate `totalOrders` across requests
  - [ ] Continue while `syncComplete === false`
  - [ ] Show progress indicator (50% when hasMore)

- [ ] **Database**
  - [ ] Create raw data table (`[pos]_orders`)
  - [ ] Add unique constraint for upserts
  - [ ] Create aggregation function (`sync_[pos]_to_unified_sales`)
  - [ ] Support date-range filtering in aggregation function
  - [ ] Add cron job to run aggregation every 5 minutes

- [ ] **Cron Jobs**
  - [ ] Bulk sync (every 6 hours): fetch from POS API
  - [ ] Aggregation sync (every 5 minutes): `[pos]_orders → unified_sales`

### Best Practices

✅ **DO:**
- Use small batch sizes (10-30 orders per request)
- Implement retry logic with delays for CPU recovery
- Use upserts for idempotent operations
- Separate raw data storage from aggregation
- Use cron jobs for aggregation (decoupled from import)
- Return progress indicators for long operations
- Process date ranges in small chunks (1 day at a time for initial sync)

❌ **DON'T:**
- Process hundreds of orders in a single request
- Skip retry logic (CPU limits are transient)
- Assume aggregation will complete in import request
- Use `INSERT` without `ON CONFLICT` (causes duplicates on retry)
- Aggregate entire dataset on each request (use date-range)
- Block UI without progress feedback

### Error Handling

| Error Type | Handling |
|------------|----------|
| CPU limit (soft) | Frontend retries with 2s delay |
| Network error | Frontend retries up to 3 times |
| POS API 401 | Refresh token, retry once |
| POS API 429 | Exponential backoff |
| Database constraint | Log and continue (idempotent) |
| Aggregation timeout | Cron will retry in 5 minutes |

### Monitoring

Log these metrics for debugging:

```typescript
console.log('[TOAST-SYNC] Batch complete', {
  restaurantId,
  ordersProcessed: totalOrders,
  hasMore: result.hasMore,
  elapsedMs: Date.now() - startTime
});
```

Key metrics to track:
- Orders processed per request
- Total sync duration
- Retry count per sync
- CPU limit hits (check Supabase logs)
- Aggregation lag (time between import and unified_sales)

---

## 🤖 AI & Machine Learning

### Overview

We use **OpenRouter** as our AI provider, which gives us access to multiple LLMs with automatic fallback. This provides reliability and cost optimization (free models first, paid models as fallback).

### Multi-Model Fallback Pattern

All AI Edge Functions follow this pattern:

```typescript
// Model configurations (free → paid)
const MODELS = [
  { name: "Llama 4 Maverick Free", id: "meta-llama/llama-4-maverick:free", maxRetries: 2 },
  { name: "Gemma 3 27B Free", id: "google/gemma-3-27b-it:free", maxRetries: 2 },
  { name: "Gemini 2.5 Flash Lite", id: "google/gemini-2.5-flash-lite", maxRetries: 1 },
  { name: "Claude Sonnet 4.5", id: "anthropic/claude-sonnet-4-5", maxRetries: 1 },
];

// Try models in order
for (const modelConfig of MODELS) {
  const response = await callModel(modelConfig, prompt, apiKey);
  if (response?.ok) {
    return await response.json();
  }
  // Try next model
}

// All models failed
return { error: "AI service temporarily unavailable" };
```

### AI Use Cases

#### 1. Bank Transaction Categorization

**Function**: `ai-categorize-transactions`

**Purpose**: Automatically categorize bank transactions to chart of accounts

**Pattern**:
```typescript
// Input
{
  restaurantId: string,
  // Auto-fetches uncategorized transactions
}

// AI Prompt includes:
// - Full chart of accounts
// - Transaction details (description, merchant, amount, date)

// Output (structured JSON)
{
  categorizations: [
    {
      transaction_id: "uuid",
      account_code: "4000",        // Must exist in chart of accounts
      confidence: "high|medium|low",
      reasoning: "explanation"
    }
  ]
}

// Database Update
UPDATE bank_transactions SET
  suggested_category_id = [account.id],
  ai_confidence = [confidence],
  ai_reasoning = [reasoning],
  is_categorized = false  -- User must approve
```

**Key Features**:
- **Validation**: Ensures AI-suggested account codes exist in chart
- **Batch Processing**: Handles up to 100 transactions per call
- **User Approval**: AI suggestions stored separately from final categorization
- **Structured Output**: Uses OpenRouter's JSON schema for guaranteed format

#### 2. Product Enhancement (Web Search → AI)

**Function**: `enhance-product-ai`

**Purpose**: Enhance product data using web search results

**Pattern**:
```typescript
// Input
{
  searchText: string,         // Google search results
  productName: string,
  brand: string,
  category: string,
  currentDescription: string
}

// Output
{
  enhancedData: {
    description: string,
    nutritionalInfo: string | null,
    ingredients: string | null,
    allergens: string[] | null,
    shelfLife: string | null,
    storageInstructions: string | null
  }
}
```

#### 3. OCR (Receipt/Product Image Analysis)

**Function**: `grok-ocr`

**Purpose**: Extract text and structured data from images

**Pattern**:
```typescript
// Input
{
  imageData: string  // base64 encoded image
}

// Output
{
  text: string,  // Raw extracted text
  structuredData: {
    brand: string,
    productName: string,
    sizeValue: number | null,
    sizeUnit: string | null,
    packageDescription: string,
    supplier: string,
    batchLot: string,
    upcBarcode: string,
    ingredients: string,
    nutritionFacts: string
  },
  confidence: number,  // 0.0 - 1.0
  source: string       // Model used
}
```

**Specialized Prompt**:
- Optimized for food packaging and restaurant inventory
- Focuses on supplier detection (Sysco, US Foods, etc.)
- Extracts batch numbers, lot codes, expiration dates
- Preserves exact spelling and units

### OpenRouter Configuration

**Environment Variables**:
- `OPENROUTER_API_KEY` - API key for OpenRouter

**Request Headers**:
```typescript
{
  "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
  "HTTP-Referer": "https://app.easyshifthq.com",
  "X-Title": "EasyShiftHQ [Feature Name]",
  "Content-Type": "application/json"
}
```

### Best Practices

✅ **DO:**
- Try free models first, paid models as fallback
- Implement retry logic with exponential backoff
- Use structured output (JSON schema) when possible
- Validate AI responses (don't trust blindly)
- Provide detailed, specific prompts
- Set appropriate `temperature` (0.1 for extraction, 0.7 for generation)
- Log model success/failure for monitoring
- Handle rate limits (429) gracefully

❌ **DON'T:**
- Use only paid models (unnecessary cost)
- Skip validation of AI output
- Auto-apply AI suggestions without user review
- Send sensitive data to AI (PII, credentials)
- Use generic prompts (be specific)
- Retry indefinitely (set max retries)
- Assume AI output is always valid JSON

### Cost Optimization

1. **Free Models First**: Llama 4 Maverick Free, Gemma 3 27B Free
2. **Paid Fallback**: Only if free models fail
3. **Batch Processing**: Process multiple items per request
4. **Smart Caching**: Cache AI results where appropriate
5. **User Approval**: Don't re-run AI for unchanged data

### Error Handling

```typescript
// Always return graceful errors
if (!response?.ok) {
  return {
    error: "AI service temporarily unavailable",
    details: "Specific error message",
    fallback: "Manual categorization required"
  };
}

// Validate before using
try {
  const result = JSON.parse(aiResponse);
  // Validate structure
  if (!result.categorizations || !Array.isArray(result.categorizations)) {
    throw new Error("Invalid format");
  }
} catch (e) {
  // Handle gracefully
}
```

---

## 💳 Invoicing & Payments

### Overview

We use **Stripe Connect** and **Stripe Invoicing** to enable restaurants to create invoices and receive payments directly. This follows **Model A: Restaurant as Merchant of Record**, where each restaurant onboards as a Stripe Connect account and receives funds directly.

### Payment Methods Supported

- **Credit/Debit Cards** - Instant settlement
- **ACH Direct Debit (US Bank Account)** - 5-7 business day settlement
- Both use Stripe Financial Connections for secure bank account linking

### Architecture Pattern

**Hook**: `useStripeConnect.tsx`, `useCustomers.tsx`, `useInvoices.tsx`

```typescript
// 1. Onboard restaurant to Stripe Connect
const { createAccount } = useStripeConnect(restaurantId);
await createAccount('express'); // Creates account and opens onboarding

// 2. Create customer
const { createCustomer } = useCustomers(restaurantId);
await createCustomer({
  name: "Acme Corp",
  email: "billing@acme.com",
  phone: "(555) 123-4567",
});

// 3. Create invoice
const { createInvoice } = useInvoices(restaurantId);
await createInvoice({
  customerId: customer.id,
  lineItems: [
    { description: "Catering Service", quantity: 1, unit_amount: 50000 }, // $500 in cents
    { description: "Additional Staff", quantity: 2, unit_amount: 15000 },  // $150 in cents
  ],
  dueDate: "2024-12-31",
  description: "Holiday Party Catering",
});

// 4. Send invoice to customer
const { sendInvoice } = useInvoices(restaurantId);
await sendInvoice(invoice.id); // Finalizes and emails to customer
```

### Database Schema

#### `customers` Table
Stores customer information for invoicing:
- `id`, `restaurant_id`, `stripe_customer_id`
- `name`, `email`, `phone`
- Billing address fields
- `notes` for internal use

#### `stripe_connected_accounts` Table
Tracks Stripe Connect account status:
- `restaurant_id`, `stripe_account_id`
- `account_type` ('express' or 'standard')
- `charges_enabled`, `payouts_enabled`, `onboarding_complete`

#### `invoices` Table
Mirrors Stripe invoice state (source of truth: Stripe):
- `id`, `restaurant_id`, `customer_id`
- `stripe_invoice_id`, `invoice_number`
- `status` ('draft', 'open', 'paid', 'void', 'uncollectible')
- Financial fields (all in cents): `subtotal`, `tax`, `total`, `amount_due`, `amount_paid`
- `hosted_invoice_url`, `invoice_pdf_url`

#### `invoice_line_items` Table
Itemized invoice details:
- `invoice_id`, `description`, `quantity`, `unit_amount`
- `tax_behavior`, `tax_rate`

#### `invoice_payments` Table
Payment attempt tracking (updated via webhooks):
- `invoice_id`, `stripe_payment_intent_id`
- `amount`, `currency`, `payment_method_type`
- `status`, `failure_message`

### Edge Functions

#### 1. `stripe-create-connected-account`
Creates Stripe Connect account for restaurant.
- **Input**: `{ restaurantId, accountType }`
- **Output**: `{ accountId, onboardingUrl }`
- **Flow**: 
  1. Verify user is restaurant owner
  2. Create Stripe Connect account (Express by default)
  3. Enable capabilities: `card_payments`, `us_bank_account_ach_payments`, `transfers`
  4. Generate onboarding link
- **Security**: Only restaurant owners can create accounts

#### 2. `stripe-create-customer`
Syncs local customer to Stripe (on connected account).
- **Input**: `{ customerId }`
- **Output**: `{ stripeCustomerId }`
- **Flow**:
  1. Get customer from local database
  2. Create Stripe customer on behalf of connected account
  3. Store `stripe_customer_id` in local database

#### 3. `stripe-create-invoice`
Creates invoice with line items.
- **Input**: `{ restaurantId, customerId, lineItems, dueDate, description }`
- **Output**: `{ invoiceId, stripeInvoiceId, status, total }`
- **Flow**:
  1. Verify connected account is active
  2. Create invoice items in Stripe
  3. Create invoice with:
     - `payment_method_types: ['card', 'us_bank_account']`
     - `on_behalf_of: connectedAccountId`
     - `transfer_data.destination: connectedAccountId`
  4. Store invoice and line items in local database
- **Status**: Invoice created as 'draft'

#### 4. `stripe-send-invoice`
Finalizes and sends invoice to customer.
- **Input**: `{ invoiceId }`
- **Output**: `{ status, hostedInvoiceUrl, invoicePdfUrl }`
- **Flow**:
  1. Verify invoice is in 'draft' status
  2. Finalize invoice (makes immutable)
  3. Send invoice via Stripe (emails customer)
  4. Update local status to 'open'
- **Note**: Customer can pay via hosted invoice page

#### 5. `stripe-invoice-webhook`
Handles invoice lifecycle events.
- **Events**: 
  - `invoice.finalized`, `invoice.sent`
  - `invoice.payment_succeeded`, `invoice.payment_failed`
  - `invoice.voided`, `invoice.marked_uncollectible`
- **Flow**:
  1. Verify webhook signature
  2. Check for duplicate events
  3. Update local invoice status
  4. Record payment attempts
- **Security**: Webhook secret required

### UI Flow

1. **Customers Page** (`/customers`)
   - List all customers
   - Create/edit customer information
   - Quick "Create Invoice" action per customer

2. **Invoices Page** (`/invoices`)
   - List all invoices with status badges
   - Filter by status (draft, open, paid, etc.)
   - View Stripe Connect onboarding status

3. **Invoice Form** (`/invoices/new`)
   - Select customer
   - Add multiple line items (description, quantity, price)
   - Set due date, footer, internal memo
   - Real-time total calculation
   - Save as draft or send immediately

4. **Invoice Details** (future)
   - View full invoice
   - Send/resend invoice
   - View payment history
   - Download PDF
   - Mark as void/uncollectible

### Payment Flow

```
User Creates Invoice (Draft)
  ↓
Manager Sends Invoice → Stripe Finalizes → Email to Customer
  ↓
Customer Opens Hosted Invoice Page
  ↓
Customer Selects Payment Method:
  - Card: Instant authorization → Settlement in 2-7 days
  - ACH: Micro-deposit verification (if first time) → Debit in 5-7 days
  ↓
Stripe Webhook: invoice.payment_succeeded
  ↓
Update Local Status to "Paid"
  ↓
Funds Settle to Restaurant's Bank Account
```

### Stripe Connect Onboarding

**Requirements for charges_enabled = true:**
- Business details (name, address, EIN/SSN)
- Bank account for payouts (can use Financial Connections)
- Identity verification (owner)
- Terms of service acceptance

**Express vs Standard:**
- **Express** (recommended): Stripe-hosted onboarding, faster setup
- **Standard**: Full API control, more complex

### Best Practices

✅ **DO:**
- Always check `charges_enabled` before allowing invoice creation
- Use webhook events as source of truth for payment status
- Store amounts in cents (integers) to avoid floating-point errors
- Set `on_behalf_of` and `transfer_data` for proper fund routing
- Enable both card and ACH payment methods
- Validate invoice totals before sending

❌ **DON'T:**
- Don't compute payment status locally - trust Stripe webhooks
- Don't allow editing invoices after finalization
- Don't skip webhook signature verification
- Don't store raw Stripe customer tokens in database
- Don't create invoices on platform account (use connected account)

### RLS Policies

All tables enforce restaurant-level isolation:
- Users can only access data for restaurants they belong to
- Only owners/managers can create/manage invoices
- Staff cannot access invoicing features
- Service role can write payments (via webhooks)

### Testing

**Unit Tests**: `tests/unit/invoiceCalculations.test.ts`
- Line item calculations (quantity × unit_amount)
- Tax calculations (per-item and subtotal)
- Total calculations (subtotal + tax)
- Currency conversion (dollars ↔ cents)
- Payment tracking (amount_remaining)

**SQL Tests**: `supabase/tests/10_invoicing_tables.sql`
- Table existence
- Column definitions
- Foreign key relationships
- RLS policy enforcement

---

## 💳 Subscription Billing

### Overview

EasyShiftHQ uses **Stripe Billing** for subscription management with three tiers:
- **Starter** ($99/mo): Basic P&L and inventory
- **Growth** ($199/mo): Advanced operations & automation
- **Pro** ($299/mo): Full suite with AI

New signups get a **14-day Growth trial**. Volume discounts apply for multi-location restaurants.

### Subscription Tiers & Features

| Feature | Starter | Growth | Pro |
|---------|---------|--------|-----|
| Daily P&L Dashboard | ✅ | ✅ | ✅ |
| Basic Inventory | ✅ | ✅ | ✅ |
| POS Integration | ✅ | ✅ | ✅ |
| Financial Intelligence | ❌ | ✅ | ✅ |
| Inventory Automation (OCR) | ❌ | ✅ | ✅ |
| Employee Scheduling | ❌ | ✅ | ✅ |
| AI Assistant | ❌ | ❌ | ✅ |

### Volume Discounts

| Locations | Discount |
|-----------|----------|
| 1-2 | 0% |
| 3-5 | 5% |
| 6-10 | 10% |
| 11+ | 15% |

### Environment Variables

**Required for Edge Functions** (set via `supabase secrets set`):

```bash
# Core Stripe keys
STRIPE_SECRET_KEY=sk_test_...              # Stripe secret key

# Webhook secret (required for production)
STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=whsec_... # From Stripe Dashboard or CLI
```

**Optional overrides** (defaults are hardcoded for production):

```bash
# Price IDs (override for test mode)
STRIPE_PRICE_STARTER_MONTHLY=price_test_...
STRIPE_PRICE_STARTER_ANNUAL=price_test_...
STRIPE_PRICE_GROWTH_MONTHLY=price_test_...
STRIPE_PRICE_GROWTH_ANNUAL=price_test_...
STRIPE_PRICE_PRO_MONTHLY=price_test_...
STRIPE_PRICE_PRO_ANNUAL=price_test_...

# Volume discount coupon IDs
STRIPE_COUPON_VOLUME_5=coupon_id     # 5% discount (3-5 locations)
STRIPE_COUPON_VOLUME_10=coupon_id    # 10% discount (6-10 locations)
STRIPE_COUPON_VOLUME_15=coupon_id    # 15% discount (11+ locations)
```

### Edge Functions

#### 1. `stripe-subscription-checkout`

Creates Stripe Checkout session for subscription purchase.

- **Input**: `{ restaurantId, tier, period }`
- **Output**: `{ success, sessionId, url }`
- **Flow**:
  1. Verify user is restaurant owner
  2. Get or create Stripe customer
  3. Count owner's restaurants for volume discount
  4. Create checkout session with appropriate price and coupon
  5. Return checkout URL

#### 2. `stripe-subscription-webhook`

Handles subscription lifecycle events from Stripe.

- **Events**:
  - `checkout.session.completed` - Initial subscription created
  - `customer.subscription.created/updated` - Subscription changes
  - `customer.subscription.deleted` - Cancellation
  - `invoice.payment_succeeded` - Payment recovered
  - `invoice.payment_failed` - Payment failed
- **Security**: Verifies webhook signature
- **Updates**: Restaurant's `subscription_tier`, `subscription_status`, `subscription_ends_at`

#### 3. `stripe-customer-portal`

Opens Stripe Customer Portal for self-service billing management.

- **Input**: `{ restaurantId }`
- **Output**: `{ success, url }`
- **Features**: Update payment method, view invoices, cancel subscription

### Database Schema

The `restaurants` table stores subscription state:

```sql
-- Subscription fields on restaurants table
subscription_tier: 'starter' | 'growth' | 'pro'
subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered'
subscription_period: 'monthly' | 'annual'
trial_ends_at: timestamp
subscription_ends_at: timestamp
grandfathered_until: timestamp
stripe_subscription_id: text
stripe_subscription_customer_id: text
```

### Frontend Hook

**Hook**: `useSubscription.tsx`

```typescript
const {
  // Current state
  effectiveTier,          // Computed tier (handles trials/grandfathering)
  subscription,           // Raw subscription info

  // Status checks
  isTrialing,
  isActive,
  isPastDue,
  isCanceled,
  isGrandfathered,

  // Time remaining
  trialDaysRemaining,
  grandfatheredDaysRemaining,

  // Feature access
  hasFeature,             // (featureKey) => boolean
  needsUpgrade,           // (featureKey) => boolean

  // Volume discount
  volumeDiscount,
  ownedRestaurantCount,

  // Actions
  createCheckout,         // Start checkout flow
  openPortal,             // Open billing portal
} = useSubscription();
```

### Local Testing

1. **Start Stripe CLI to forward webhooks:**
   ```bash
   stripe listen --forward-to localhost:54321/functions/v1/stripe-subscription-webhook
   ```
   Copy the `whsec_...` secret it provides.

2. **Set secrets for local Supabase:**
   ```bash
   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   supabase secrets set STRIPE_SUBSCRIPTION_WEBHOOK_SECRET=whsec_...
   ```

3. **Test checkout flow:**
   - Navigate to Settings > Subscription
   - Select a plan and click Subscribe
   - Use Stripe test card: `4242 4242 4242 4242`

4. **Test UI without Stripe:**
   - UI components read subscription state from database
   - Manually update `restaurants.subscription_tier` and `subscription_status` to test different states

### Best Practices

✅ **DO:**
- Verify webhook signatures
- Use `effectiveTier` for feature gating (handles trials/grandfathering)
- Show trial countdown prominently
- Provide clear upgrade paths for locked features
- Test all subscription states (trialing, active, past_due, canceled)

❌ **DON'T:**
- Trust client-side subscription checks for security (enforce in RLS/Edge Functions)
- Skip webhook signature verification
- Hardcode price IDs in frontend (use backend)
- Block users completely on past_due (grace period)

### UI Components

The subscription journey includes these touchpoints:

1. **Welcome Modal** (`WelcomeModal.tsx`) - Post-signup pricing overview
2. **Trial Badge** (`AppHeader.tsx`) - Countdown in header
3. **Sidebar Badges** (`AppSidebar.tsx`) - Pro badges on locked features
4. **Onboarding Drawer** (`OnboardingDrawer.tsx`) - Subscription-aware setup steps
5. **Billing Preview** (`AppHeader.tsx`) - Shows cost when adding restaurants
6. **Subscription Settings** (`/settings?tab=subscription`) - Full billing management

---

## 💾 Supabase Usage Patterns

### Query Patterns

#### 1. Direct Queries in Hooks (Legacy Pattern)

**Example**: `useProducts.tsx`

```typescript
// ❌ OLD PATTERN (still in use, but not recommended for new code)
const fetchProducts = async () => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true });
    
  if (error) throw error;
  setProducts(data || []);
};

useEffect(() => {
  fetchProducts();
}, [restaurantId]);
```

**Issues**:
- Manual state management
- No automatic refetching
- No caching
- Boilerplate error handling

#### 2. React Query Pattern (Recommended)

**Example**: `useStripeFinancialConnections.tsx`

```typescript
// ✅ RECOMMENDED PATTERN
const {
  data: connectedBanks = [],
  isLoading,
  error,
} = useQuery({
  queryKey: ['connectedBanks', restaurantId],
  queryFn: async () => {
    const { data, error } = await supabase
      .from('connected_banks')
      .select(`
        id,
        institution_name,
        balances:bank_account_balances(
          account_name,
          current_balance
        )
      `)
      .eq('restaurant_id', restaurantId)
      .eq('status', 'connected');
      
    if (error) throw error;
    return data;
  },
  enabled: !!restaurantId,
  staleTime: 60000,              // 60 seconds
  refetchOnWindowFocus: true,
  refetchOnMount: true,
});
```

**Benefits**:
- Automatic caching with short stale time
- Window focus refetching (always fresh)
- Loading and error states built-in
- Automatic retries
- Query invalidation on mutations

#### 3. Real-time Subscriptions

```typescript
useEffect(() => {
  if (!restaurantId) return;

  const channel = supabase
    .channel('connected-banks-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'connected_banks',
        filter: `restaurant_id=eq.${restaurantId}`,
      },
      () => {
        // Invalidate React Query cache
        queryClient.invalidateQueries({ 
          queryKey: ['connectedBanks', restaurantId] 
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [restaurantId, queryClient]);
```

**Best Practices**:
- Always clean up subscriptions
- Invalidate React Query cache on changes
- Filter subscriptions by restaurant_id
- Use specific event types when possible

#### 4. RPC (Remote Procedure Calls)

```typescript
// For complex queries or operations
const { data, error } = await supabase.rpc('sync_square_to_unified_sales', {
  p_restaurant_id: restaurantId
});
```

**When to use RPC**:
- Complex multi-table operations
- Business logic that should be in database
- Atomic operations
- Performance-critical queries

#### 5. Edge Function Invocation

```typescript
const { data, error } = await supabase.functions.invoke(
  'stripe-sync-transactions',
  {
    body: { bankId }
  }
);
```

**When to use Edge Functions**:
- Third-party API calls
- Operations requiring secrets
- Heavy processing
- Webhooks
- OAuth flows

### Best Practices

✅ **DO:**
- Use React Query for all data fetching
- Set `staleTime` between 30-60 seconds
- Enable `refetchOnWindowFocus` for critical data
- Use `queryKey` with all dependencies
- Invalidate queries after mutations
- Use real-time subscriptions for live data
- Filter queries by `restaurant_id`
- Use RLS policies for security
- Use `select()` with specific columns
- Use `.maybeSingle()` when expecting 0 or 1 result

❌ **DON'T:**
- Query without `restaurant_id` filter
- Use `staleTime` > 60 seconds for critical data
- Rely only on client-side security checks
- Fetch all columns with `select('*')` unnecessarily
- Use `.single()` when result might not exist (throws error)
- Create manual polling intervals (use React Query)
- Store sensitive data in local state

### Query Optimization

```typescript
// ❌ BAD: N+1 query problem
const products = await supabase.from('products').select('*');
for (const product of products) {
  const supplier = await supabase
    .from('suppliers')
    .select('*')
    .eq('id', product.supplier_id)
    .single();
}

// ✅ GOOD: Join in one query
const { data } = await supabase
  .from('products')
  .select(`
    *,
    supplier:suppliers(
      id,
      name,
      contact_email
    )
  `)
  .eq('restaurant_id', restaurantId);
```

### Mutation Pattern

```typescript
const { mutate } = useMutation({
  mutationFn: async (bankId: string) => {
    const { data, error } = await supabase.functions.invoke(
      'stripe-disconnect-bank',
      { body: { bankId, deleteData: true } }
    );
    if (error) throw error;
    return data;
  },
  onSuccess: () => {
    // Invalidate and refetch
    queryClient.invalidateQueries({ 
      queryKey: ['connectedBanks', restaurantId] 
    });
    toast({ title: "Bank disconnected" });
  },
  onError: (error) => {
    toast({ 
      title: "Failed to disconnect", 
      description: error.message,
      variant: "destructive" 
    });
  },
});
```

---

## ⚡ Edge Functions Architecture

### Structure

```
supabase/functions/
├── _shared/              # Shared utilities
│   ├── cors.ts          # CORS headers
│   └── encryption.ts    # AES-GCM encryption service
├── [function-name]/
│   └── index.ts
```

### Shared Utilities

#### Encryption Service

**Purpose**: Encrypt/decrypt sensitive data (OAuth tokens, API keys)

**Usage**:
```typescript
import { getEncryptionService } from '../_shared/encryption.ts';

const encryption = await getEncryptionService();
const encrypted = await encryption.encrypt(accessToken);
const decrypted = await encryption.decrypt(encryptedToken);
```

**Algorithm**: AES-GCM with 96-bit IV
**Key Source**: `ENCRYPTION_KEY` environment variable (32 bytes)

**Security Features**:
- Random IV for each encryption
- Input validation
- Secure key derivation
- Error handling without leaking data

#### CORS Headers

```typescript
import { corsHeaders } from '../_shared/cors.ts';

return new Response(JSON.stringify(data), {
  headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
```

### Function Pattern

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 2. Initialize Supabase client
    const authHeader = req.headers.get('Authorization');
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    // 3. Authenticate user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    // 4. Parse request
    const { restaurantId, ...params } = await req.json();

    // 5. Verify permissions
    const { data: userRestaurant } = await supabaseClient
      .from('user_restaurants')
      .select('role')
      .eq('user_id', user.id)
      .eq('restaurant_id', restaurantId)
      .single();

    if (!userRestaurant || !['owner', 'manager'].includes(userRestaurant.role)) {
      throw new Error('Access denied');
    }

    // 6. Execute business logic
    const result = await performOperation(params);

    // 7. Return response
    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: error.message === 'Unauthorized' ? 401 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
```

### Best Practices

✅ **DO:**
- Always handle OPTIONS requests (CORS)
- Use service role for operations that bypass RLS
- Validate user permissions in code (RLS bypassed)
- Use try-catch for error handling
- Log errors for debugging
- Return consistent error format
- Use Deno imports (esm.sh for npm packages)
- Set appropriate HTTP status codes
- Use environment variables for secrets

❌ **DON'T:**
- Expose secrets in responses
- Skip permission checks (service role bypasses RLS)
- Return sensitive data to unauthorized users
- Use Node.js imports (use Deno)
- Log sensitive data (tokens, passwords)
- Return stack traces in production
- Use synchronous blocking operations

---

## 🔒 Security Best Practices

### 1. Credential Management

**Never store in database**:
- Bank account credentials
- OAuth access tokens (store encrypted only)
- API keys
- Passwords

**Use**:
- Stripe for bank credential storage
- AES-GCM encryption for OAuth tokens
- Environment variables for API keys
- Supabase Auth for user passwords

### 2. Token Encryption

```typescript
// Always encrypt before storing
const encryption = await getEncryptionService();
const encryptedToken = await encryption.encrypt(accessToken);

await supabase.from('square_connections').insert({
  access_token: encryptedToken,  // Never store plain text
  // ...
});

// Decrypt when using
const decryptedToken = await encryption.decrypt(connection.access_token);
```

### 3. Webhook Signature Verification

```typescript
// ALWAYS verify webhooks
const signature = req.headers.get('x-webhook-signature');
const computedSignature = createHmac('sha256', WEBHOOK_SECRET)
  .update(payload)
  .digest('base64');

if (signature !== computedSignature) {
  return new Response('Invalid signature', { status: 401 });
}
```

### 4. Row Level Security (RLS)

**Always enable RLS** on tables with sensitive data:

```sql
-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Users can view their restaurant's products"
ON products FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = products.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);
```

**Edge Functions bypass RLS** - Always validate permissions in code:

```typescript
// Verify user has access to restaurant
const { data: userRestaurant } = await supabase
  .from('user_restaurants')
  .select('role')
  .eq('user_id', user.id)
  .eq('restaurant_id', restaurantId)
  .single();

if (!userRestaurant) {
  throw new Error('Access denied');
}
```

### 5. Idempotency

**For webhooks and critical operations**:

```typescript
// Check if already processed
const { data: existing } = await supabase
  .from('processed_webhooks')
  .select('id')
  .eq('webhook_id', webhookId)
  .maybeSingle();

if (existing) {
  return new Response('Already processed', { status: 200 });
}

// Process and mark as processed
await processWebhook(data);
await supabase.from('processed_webhooks').insert({ webhook_id: webhookId });
```

### 6. Rate Limiting

**For third-party API calls**:

```typescript
// Implement exponential backoff
let retryCount = 0;
while (retryCount < MAX_RETRIES) {
  const response = await fetch(apiUrl);
  
  if (response.status === 429) {
    const waitTime = Math.pow(2, retryCount) * 1000;
    await new Promise(resolve => setTimeout(resolve, waitTime));
    retryCount++;
  } else {
    break;
  }
}
```

### 7. Input Validation

```typescript
// Always validate inputs
if (!restaurantId || typeof restaurantId !== 'string') {
  throw new Error('Invalid restaurant ID');
}

// Sanitize file names
const sanitized = fileName
  .replace(/[^a-zA-Z0-9_.-]/g, '_')
  .substring(0, 255);
```

---

## ⚡ Performance & Real-Time Considerations

### Data Freshness Requirements

This is a **real-time system** - stale data causes operational issues.

**Critical Data** (refresh every 30-60s):
- Inventory levels
- Sales data
- Bank balances
- P&L calculations

**Less Critical** (refresh every 5 min):
- Product catalog
- Supplier lists
- User settings

### React Query Configuration

```typescript
// Critical data
useQuery({
  queryKey: ['inventory', restaurantId],
  queryFn: fetchInventory,
  staleTime: 30000,           // 30 seconds
  refetchOnWindowFocus: true, // Always check when user returns
  refetchOnMount: true,       // Check on mount
  refetchInterval: 60000,     // Poll every minute
});

// Less critical data
useQuery({
  queryKey: ['suppliers', restaurantId],
  queryFn: fetchSuppliers,
  staleTime: 300000,          // 5 minutes
  refetchOnWindowFocus: false,
  refetchOnMount: false,
});
```

### Real-time Subscriptions

**When to use**:
- Data changes frequently
- Multiple users editing same data
- UI must reflect changes immediately

**Example**: Bank transactions

```typescript
useEffect(() => {
  const channel = supabase
    .channel(`transactions-${restaurantId}`)
    .on('postgres_changes', 
      { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'bank_transactions',
        filter: `restaurant_id=eq.${restaurantId}`
      },
      () => {
        queryClient.invalidateQueries({ 
          queryKey: ['transactions', restaurantId] 
        });
      }
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}, [restaurantId]);
```

### Caching Strategy

✅ **Safe to cache**:
- Memoized calculations (`useMemo`)
- Callback functions (`useCallback`)
- Memoized components (`React.memo`)
- React Query with short `staleTime`

❌ **Never cache manually**:
- localStorage for data
- Module-level variables
- Service Workers for API data
- Long `staleTime` (>60s) for critical data

### Background Jobs

**For long-running operations**:

```typescript
// 1. Start background job
const { data, error } = await supabase.functions.invoke(
  'bulk-operation',
  { body: { restaurantId } }
);

if (data.background) {
  toast({ 
    title: "Processing in background",
    description: "This will take a few minutes..."
  });
}

// 2. Poll for completion (or use real-time subscription)
const checkStatus = async () => {
  const { data } = await supabase
    .from('background_jobs')
    .select('status')
    .eq('id', jobId)
    .single();
    
  if (data.status === 'completed') {
    queryClient.invalidateQueries({ queryKey: ['data'] });
  }
};
```

### Database Optimization

**Use database functions for**:
- Aggregations
- Complex joins
- Bulk operations
- Calculated fields

```typescript
// ❌ BAD: Fetch all, calculate in JavaScript
const transactions = await supabase.from('transactions').select('*');
const total = transactions.reduce((sum, t) => sum + t.amount, 0);

// ✅ GOOD: Calculate in database
const { data } = await supabase.rpc('calculate_transaction_total', {
  p_restaurant_id: restaurantId
});
```

---

## 📚 Quick Reference

### Edge Function Checklist

- [ ] Handle OPTIONS (CORS)
- [ ] Authenticate user
- [ ] Verify permissions (service role bypasses RLS)
- [ ] Validate inputs
- [ ] Use try-catch
- [ ] Return consistent error format
- [ ] Log errors (not sensitive data)
- [ ] Use environment variables for secrets

### Integration Checklist

- [ ] Implement OAuth flow
- [ ] Encrypt tokens before storage
- [ ] Verify webhook signatures
- [ ] Handle token refresh
- [ ] Implement idempotency
- [ ] Use adapter pattern for POS
- [ ] Write to unified tables
- [ ] Invalidate React Query cache after sync

### Security Checklist

- [ ] Enable RLS on all tables
- [ ] Never store credentials
- [ ] Verify webhook signatures
- [ ] Validate permissions in Edge Functions
- [ ] Encrypt sensitive data
- [ ] Sanitize user inputs
- [ ] Use HTTPS only
- [ ] Implement rate limiting

### Performance Checklist

- [ ] Use React Query (not manual state)
- [ ] Set `staleTime` ≤ 60s for critical data
- [ ] Enable `refetchOnWindowFocus`
- [ ] Use real-time subscriptions for live data
- [ ] Invalidate cache on mutations
- [ ] Use database functions for aggregations
- [ ] Implement background jobs for bulk ops
- [ ] Monitor and log performance metrics

---

## 💡 Performance & Maintainability Tips

### Hook Composition

**Compose hooks for reusability**:

```typescript
// ✅ GOOD: Compose smaller hooks
export const useSquareIntegration = (restaurantId: string | null) => {
  const [isConnected, setIsConnected] = useState(false);
  const [connection, setConnection] = useState<SquareConnection | null>(null);
  
  const checkConnectionStatus = useCallback(async () => {
    // Check logic
  }, [restaurantId]);
  
  useEffect(() => {
    checkConnectionStatus();
  }, [restaurantId, checkConnectionStatus]);
  
  return { isConnected, connection, checkConnectionStatus };
};

// Use in adapter
export const useSquareSalesAdapter = (restaurantId: string | null): POSAdapter => {
  const { isConnected, connection } = useSquareIntegration(restaurantId);
  // Adapter logic
};
```

### Memoization Strategy

**Use memoization for expensive calculations**:

```typescript
// Memoize derived values
const filteredProducts = useMemo(() => {
  return products.filter(p => p.name.includes(searchTerm));
}, [products, searchTerm]);

// Memoize callbacks
const handleSync = useCallback(async () => {
  await syncTransactions(bankId);
}, [bankId]);

// Memoize entire hook return
return useMemo(() => ({
  isConnected,
  fetchSales,
  syncToUnified,
}), [isConnected, fetchSales, syncToUnified]);
```

### Error Boundaries

**Wrap components with error boundaries**:

```typescript
// Prevent integration failures from crashing app
<ErrorBoundary fallback={<ErrorDisplay />}>
  <BankIntegrationPanel />
</ErrorBoundary>
```

### Loading States

**Always show loading states for async operations**:

```typescript
// ✅ GOOD: Show loading, success, and error states
const { mutate: syncTransactions, isLoading } = useMutation({
  mutationFn: async (bankId: string) => {
    const { data, error } = await supabase.functions.invoke('stripe-sync-transactions', {
      body: { bankId }
    });
    if (error) throw error;
    return data;
  },
  onSuccess: (data) => {
    toast({ title: "Synced", description: `${data.synced} transactions imported` });
  },
  onError: (error) => {
    toast({ title: "Sync failed", description: error.message, variant: "destructive" });
  },
});

// In UI
{isLoading ? (
  <Button disabled>
    <Loader className="mr-2 h-4 w-4 animate-spin" />
    Syncing...
  </Button>
) : (
  <Button onClick={() => syncTransactions(bankId)}>
    Sync Transactions
  </Button>
)}
```

### Type Safety

**Use TypeScript strictly**:

```typescript
// ✅ GOOD: Strong typing
interface BankConnection {
  id: string;
  institution_name: string;
  status: 'connected' | 'disconnected' | 'error';
  balances: BankAccountBalance[];
}

// ❌ BAD: Any types
const connection: any = await fetchConnection();
```

### API Response Validation

**Validate third-party API responses**:

```typescript
// ✅ GOOD: Validate structure
const response = await fetch(squareApiUrl);
const data = await response.json();

if (!data.orders || !Array.isArray(data.orders)) {
  throw new Error('Invalid response format from Square API');
}

// Map to internal format with validation
const orders = data.orders.map(order => {
  if (!order.id || !order.total_money) {
    console.warn('Skipping invalid order:', order);
    return null;
  }
  return {
    id: order.id,
    total: order.total_money.amount,
    // ...
  };
}).filter(Boolean);
```

### Retry Logic

**Implement smart retries for network operations**:

```typescript
async function fetchWithRetry(
  url: string, 
  options: RequestInit, 
  maxRetries = 3
): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) {
        return response;
      }
      
      // Don't retry 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status}`);
      }
      
      // Retry 5xx errors (server errors)
      lastError = new Error(`Server error: ${response.status}`);
      
    } catch (error) {
      lastError = error as Error;
    }
    
    // Exponential backoff
    if (i < maxRetries - 1) {
      await new Promise(resolve => 
        setTimeout(resolve, Math.pow(2, i) * 1000)
      );
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
}
```

### Logging Best Practices

**Log strategically for debugging**:

```typescript
// ✅ GOOD: Structured logging
console.log('[SQUARE-SYNC] Starting sync', {
  restaurantId,
  timestamp: new Date().toISOString(),
  orderCount: orders.length
});

// Log errors with context
console.error('[SQUARE-SYNC] Sync failed', {
  restaurantId,
  error: error.message,
  orderIds: failedOrders.map(o => o.id)
});

// ❌ BAD: Generic logging
console.log('sync started');
console.log(error);
```

### Testing Integration Code

**Test integrations with mocks**:

```typescript
// Mock Supabase client
jest.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          data: mockProducts,
          error: null
        }))
      }))
    })),
    functions: {
      invoke: jest.fn(() => ({
        data: { synced: 10 },
        error: null
      }))
    }
  }
}));

// Test hook
test('useSquareSalesAdapter fetches sales', async () => {
  const { result } = renderHook(() => 
    useSquareSalesAdapter('restaurant-123')
  );
  
  await waitFor(() => {
    expect(result.current.isConnected).toBe(true);
  });
  
  const sales = await result.current.fetchSales('restaurant-123');
  expect(sales).toHaveLength(5);
});
```

### Migration Strategy

**When updating integration patterns**:

1. **Create new pattern alongside old**
   ```typescript
   // Keep old hook working
   export const useProductsLegacy = () => { /* old implementation */ };
   
   // Add new React Query version
   export const useProducts = () => { /* new implementation */ };
   ```

2. **Migrate gradually**
   - Update one component at a time
   - Test thoroughly
   - Monitor for issues

3. **Deprecate old pattern**
   ```typescript
   /**
    * @deprecated Use useProducts instead
    */
   export const useProductsLegacy = () => {
     console.warn('useProductsLegacy is deprecated, use useProducts');
     // ...
   };
   ```

4. **Remove after migration**

### Documentation Maintenance

**Keep documentation up to date**:

- ✅ Update when adding new integrations
- ✅ Document breaking changes
- ✅ Add examples from real code
- ✅ Include troubleshooting tips
- ✅ Link to related documentation

**Review documentation**:
- When reviewing PRs
- After major changes
- Quarterly audits
- When onboarding new developers

---

## 🔗 Related Documentation

- [Architecture & Technical Guidelines](ARCHITECTURE.md)
- [GitHub Copilot Instructions](.github/copilot-instructions.md)
- [Testing Guide](supabase/tests/README.md)

---

**Last Updated**: 2026-01-29

**Maintainers**: Development Team

**Questions?** Refer to existing code in `src/hooks/` and `supabase/functions/` for examples.
