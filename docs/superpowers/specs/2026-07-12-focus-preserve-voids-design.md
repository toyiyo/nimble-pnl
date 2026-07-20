# Design: preserve Focus voids as auditable negative offsets

**Date:** 2026-07-12
**Branch:** `fix/focus-preserve-voids`

## Problem

Focus voids arrive as check-level `<DeleteRecord>` entries. Today
`focusTransactionSyncHandler.ts:357` **hard-deletes** the check from
`focus_orders` (CASCADE removes items/payments), and the sync RPC leaves the
check's `unified_sales` rows **orphaned** (they inflate revenue/tax forever —
Codex, PR #600). Net effect: voided sales silently vanish from the source data,
there is **no void audit trail** (you can't count voids or their $), and
existing rows orphan.

**Decision (user):** preserve voids with the **full, Toast-consistent** model —
soft-delete + a negative `void` offset row in `unified_sales` so voids net out
of revenue *and* stay countable/reportable.

## Read-layer facts (verified)
- **Revenue** sums `item_type='sale' AND adjustment_type IS NULL`
  (`20260501120000`, `20260501130100`).
- **Discounts** sum `adjustment_type='discount'`; **pass-through** sums an
  enumerated `adjustment_type IN ('tax','tip','service_charge','discount','fee')`
  (`KNOWN_PASS_THROUGH_TYPES`, `20260501130000`).
- ⇒ A row with **`adjustment_type='void'`** is excluded from revenue,
  discounts, and pass-through automatically. No read-layer change required.

## Design

### 1. Schema (migration)
- `ALTER TABLE public.focus_orders ADD COLUMN IF NOT EXISTS is_voided boolean
  NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS voided_at timestamptz;`
- **No `unified_sales` constraint change needed.** Verified in prod: 2,658
  `adjustment_type='void'` rows already exist (all Toast). The constraint
  `CHECK (adjustment_type IN ('tax','tip','service_charge','discount','fee',NULL))`
  has `NULL` in the list, so for any unlisted value `x IN (…,NULL)` evaluates to
  **NULL**, and a CHECK passes on NULL — i.e. the constraint already permits
  `'void'` (and, as a side effect, any value). Focus `'void'` inserts pass
  as-is; the earlier review's "un-breaks Toast / P&L backlog" concern is moot.
  (That the constraint is a permissive no-op is a real but separate data-
  integrity smell — filed as a follow-up, not fixed here.)
- **No new index.** The void DELETE/UPSERT keys off `external_order_id`, already
  covered by the existing partial unique index `unified_sales_unique_square
  (restaurant_id, pos_system, external_order_id, external_item_id) WHERE
  parent_sale_id IS NULL` (which also backs the void `ON CONFLICT`). Dropped the
  previously-proposed `idx_unified_sales_focus_active` (unsafe non-CONCURRENTLY
  build + wrong key for the query shape).

### 2. Handler — soft-delete instead of hard-delete
`focusTransactionSyncHandler.ts` DeleteRecord loop: replace `.delete()` with
`.update({ is_voided: true, voided_at: <nowIso> })`, same scoping
(`restaurant_id + business_date + focus_check_id`). Preserves the check + its
items/payments/tax so the void amount is knowable. The existing
`voidDeleteFailed`→don't-record-fingerprint retry logic is kept (now
`voidMarkFailed`). A void for a never-synced check updates 0 rows (no error) →
simply not recorded (we have no amount); the authoritative day-level count still
lives on the Focus report's `Voids N / $X` line.

### 3. RPC — branch the per-check loop on `is_voided`
Rebuild `_sync_focus_transactions_to_unified_sales_impl` from the **live prod
body** (verified ungated). Add `fo.is_voided` to the loop `SELECT`. Inside the
loop:

- **`is_voided = true`:**
  - DELETE this order's revenue rows: `item_type IN ('sale','tip','discount',
    'tax') AND external_order_id = v_order_id AND parent_sale_id IS NULL`.
  - UPSERT **one** negative void offset row:
    `external_item_id = v_order_id || '_void'`, `item_name = 'Void'`,
    `total_price = -(SELECT COALESCE(SUM(price),0) FROM focus_order_items WHERE …
    AND price != 0)` (the voided net revenue), `item_type='discount'`,
    `adjustment_type='void'`, `sale_time = v_sale_time`. `ON CONFLICT … WHERE
    parent_sale_id IS NULL DO UPDATE`.
  - Because the order row now still exists, the loop visits it — **this replaces
    the orphan-sweep** (no separate pre-loop sweep needed) and fixes the bug.
- **`is_voided = false`:** existing Steps 1–6 (sale/discount/tip/tax), plus a
  cleanup DELETE of any stale `…_void` row for this order (idempotent un-void).
  This cleanup DELETE **must** include `AND parent_sale_id IS NULL`, matching
  every other delete in the function.

**Voiding removes the whole check** — its tax/tip/discount rows are deleted, not
netted to a line. This is intended: a void means the transaction didn't happen,
so nothing from it survives except the single audit `void` offset (the negated
net revenue). Confirmed as the desired reporting behaviour.

Final aggregate: unchanged two-source UNION already re-aggregates every
processed date (voided orders still appear in the `focus_orders` date-range
branch), so daily totals reflect the removed revenue.

### 4. Void representation (verified safe)
`item_type='other'`, `adjustment_type='void'`, `total_price` negative. The
meaningful, Toast-consistent identifier is `adjustment_type='void'`; `item_type`
is `'other'` (not Toast's `'discount'`) because a void is not a discount and
`'discount'` collides with `item_type='discount'` consumers. Safe because
revenue keys on `item_type='sale'`, discounts/pass-through on `adjustment_type`
— none of which match `void`/`other`. Counting voids:
`SELECT count(*), SUM(-total_price) FROM unified_sales WHERE adjustment_type='void'`
or `SELECT count(*), SUM(total) FROM focus_orders WHERE is_voided`.

## Edge cases / idempotency
- Never-synced-then-voided check → 0-row UPDATE, no void row (can't value it).
- Voided check with no priced items → void offset `total_price = 0` (still a
  countable void marker).
- Re-sync of a voided order → idempotent (revenue rows already gone, void row
  UPSERTed).
- **User split rows are removed** when their order is voided — a void removes
  the whole check. The `parent_sale_id IS NULL` guard still protects splits in
  the **non-void** Steps 2/4/5/6 (routine re-sync must not clobber user splits),
  but the void branch deliberately omits it (whole-check removal, FK-safe single
  delete). The routine-sync split-preservation guard is covered by its own test.

## Migration & safety
- New `supabase/migrations/20260713020000_focus_preserve_voids.sql` — timestamp
  sorts after the current latest `20260713010000_harden_accept_shift_trade.sql`;
  re-check for collision immediately before PR (`git ls-tree origin/main`).
- Two statements only: the `focus_orders` `ALTER` and the `CREATE OR REPLACE`
  of the RPC. No constraint change, no index (see §1).
- `CREATE OR REPLACE` from live def (pre-flight assert: contains
  `apply_rules_to_pos_sales_internal`, no `auth.uid()`); re-apply `REVOKE ALL …
  FROM PUBLIC; GRANT EXECUTE … TO service_role` (live ACL `{postgres,
  service_role}`).

## Testing
- **pgTAP** (`supabase/tests/47_focus_transactions_unified_sales.sql`): seed
  order C (sale+tip+discount+tax) + a user split row under it; sync → rows
  exist. Set `focus_orders.is_voided=true`; re-sync → C's sale/tip/discount/tax
  rows gone, **its split child also gone** (whole check removed), **one
  `adjustment_type='void'` row present with negative `total_price`**, a **sibling
  order untouched**; assert `SUM(total_price) WHERE adjustment_type='void'`
  equals the negated revenue and revenue (`item_type='sale' AND adjustment_type
  IS NULL`) drops accordingly.
- **Unit** (`tests/unit/focusTransactionSyncHandler.test.ts`): a `<DeleteRecord>`
  drives an `update({is_voided:true})` on focus_orders, **not** a `.delete()`.

## Follow-ups (filed as chips)
- One-time cleanup of **legacy hard-deleted orphans** (rows left by the old
  hard-delete path before this change) — the new soft-delete only covers checks
  voided going forward.
- **`unified_sales_adjustment_type_check` is a permissive no-op** (NULL-in-list
  makes it accept any value) — tighten it separately (carefully: it currently
  "allows" whatever historical rows exist).
- **`focus_order_items`/`focus_payments` retention:** soft-delete now preserves
  these for voided checks (previously CASCADE-removed). Only the sync RPC +
  handler read them, so no correctness risk, but there's now no cleanup path —
  revisit if Focus volume grows.
- Optional **Voids report UI** (count/$ surface) — deferred.
