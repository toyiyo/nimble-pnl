# Design: Deposit Match (card rails MVP)

Date: 2026-09-01
Branch: `feature/deposit-match`

## Problem

Owners cannot tell if the card money from the POS reached the bank. We proved
the need on production data for one restaurant (Wetzel's - Cold Stone - Alamo
Ranch). A manual reconciliation found:

- one Shift4 deposit short by $745.68 (business date 2026-08-04);
- six small Shift4 shortfalls that total $87.66;
- one Toast shortfall of $19.67 on the first Toast day.

Today no page shows this. The owner must export data and compare by hand.

## Relationship to the prior design doc

The branch `codex/deposit-reconciliation` holds a broader design:
`docs/superpowers/specs/2026-08-31-deposit-reconciliation-design.md` (commit
`cff32b96`). This doc adopts its core decisions and narrows the scope to one
shippable PR. Adopted decisions:

- persist expected items, do not rebuild them in the browser;
- gate `late` and `short` on bank freshness;
- authorize with the intersection of `view:banking` and `view:pos_sales`;
- one read RPC feeds every view, so totals cannot drift.

Deviations, with reasons:

- **Card rail only, every POS source.** The MVP covers the card rail for
  every POS source with normalized payment rows. The cash rail comes in a
  follow-up PR. An adapter contract (below) makes each future POS source one
  small migration, with no schema change.
- **Three tables, not four.** The adjustments table waits for the cash rail.
  For card rails, the fee is a derived value: `expected - received` on a net
  rail, and separate `PROC FEE` bank debits on a gross rail.
- **Two tabs, not three.** The money-trail view folds into the overview as a
  compact waterfall. The user approved this layout in the mockup.
- **Resolution actions ship in the MVP.** The user approved the "review day"
  and "prepare dispute" flows. An item carries a resolution state.

## Settlement rules proved on production data

- **Shift4 (Focus card tenders).** One deposit per business date, gross.
  The deposit equals the sum of `focus_payments.amount` for the card tenders,
  and `amount` already includes the tip. Lag is 1-2 banking days. Fees post as
  separate `PROC FEE` debits.
- **Toast.** One deposit per business date, net of a 1.6%-3.1% fee. The
  descriptor holds a date label ("DEP AUG 24"). The label date equals the
  business date plus one day.
- Card tender literals (checked on production): Focus card tenders are
  `name IN ('Visa','MC','Amex','Discover')`; Toast card tenders are
  `payment_type = 'CREDIT'`. Other tender names (cash denominations, gift,
  `Online Ordering`) settle outside these rails. The rule stores the tender
  list in `source_config`, because other restaurants can use different names.

## POS source coverage (current and future)

The feature must support every POS source, current and future. One adapter
per source hides the source-specific tender logic. The adapter contract is
one SQL function with a fixed signature:

```sql
deposit_match_source_<source>(
  p_restaurant_id uuid, p_start date, p_end date, p_config jsonb
) RETURNS TABLE (business_date date, expected_amount numeric, row_count int)
```

A dispatcher function maps `deposit_match_rules.pos_source` to the adapter
with a static `CASE`. No dynamic SQL. To add a POS source later: write one
adapter function, add one `CASE` arm, and add one default-rule template. No
table changes.

MVP adapters, from the normalized tables in the repository:

- `focus`: `focus_payments` (`business_date`, `name`, `amount`;
  src/integrations/supabase/types.ts:3350). Settlement proved gross.
- `toast`: `toast_payments` (`payment_date`, `payment_type`;
  src/integrations/supabase/types.ts:9811). Settlement proved net.
- `square`: `square_payments` minus `square_refunds`
  (src/integrations/supabase/types.ts:8259,8312). The tender type sits in
  `raw_json` — the build phase must check the field name on real rows before
  it writes the filter.
- `revel`: `revel_payments` (`payment_date`, `payment_type`, `amount`,
  `tip_amount`; src/integrations/supabase/types.ts:6318).
- `shift4`: `shift4_charges` minus `shift4_refunds` (`service_date`;
  src/integrations/supabase/types.ts:7346,7500).
- `clover`: no normalized tender rows exist (`clover_orders` holds order
  totals only; src/integrations/supabase/types.ts:1614). The Clover adapter
  returns zero rows, and the UI shows the source as "not yet supported". No
  fake card split.

The engine trusts a rule, not an adapter, for settlement behavior (gross or
net, lag, fee band). The setup dialog proposes per-source defaults. Until an
owner confirms a rule, items from that source stay `incomplete` and never
turn `late` or `short`. This keeps unproved processors honest.

## Existing code this design builds on

- `focus_payments` rows carry `business_date`, `name`, `amount`, `tip`
  (src/integrations/supabase/types.ts:3350).
- `toast_payments` rows carry `payment_date`, `payment_type`, `amount`,
  `tip_amount` (src/integrations/supabase/types.ts:9811).
- `bank_transactions` rows carry `transaction_date`, `amount`, `description`,
  `is_transfer`, `connected_bank_id`, `restaurant_id`
  (src/integrations/supabase/types.ts:881).
- `connected_banks.data_current_through` is the authoritative freshness
  boundary. The comment in
  src/components/banking/FreshnessStamp.tsx:4-15 documents why `last_sync_at`
  is not trustworthy.
- Capability identifiers: `view:banking` and `edit:banking`
  (src/lib/permissions/areas.ts:298-300), `view:pos_sales`
  (src/lib/permissions/areas.ts:219).
- SQL capability check: `public.user_has_capability(...)`. Copy the signature
  from the latest definition
  (supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:27).
- RPC authorization pattern: `get_unified_sales_totals` raises on a failed
  restaurant check
  (supabase/migrations/20260123001310_81f88f75-9aa0-4302-81dc-4579dcd801b1.sql:22-29).
- Route registration: `/banking` renders inside `ProtectedRoute`
  (src/App.tsx:415). The accountant collaborator allow-list includes
  `/banking` (src/App.tsx:206), so a nested path inherits that entry.
- Client capability check: `usePermissions()`
  (src/hooks/usePermissions.ts:98).
- Page header component: `PageHeader` (src/components/PageHeader.tsx:15).

## Data model

Three restaurant-scoped tables. All tables carry UUID primary keys,
`restaurant_id`, timestamps, and indexes on `(restaurant_id, business_date)`
where a date exists.

RLS: each table gets exactly ONE permissive SELECT policy. Its single
`USING` clause is
`user_has_capability(restaurant_id, 'view:banking') AND
user_has_capability(restaurant_id, 'view:pos_sales')`. Do not write two
SELECT policies — permissive policies OR together, and two policies would
widen access to either capability alone (`memory/lessons.md:848`,
2026-07-03). INSERT/UPDATE/DELETE each get one policy that requires
`edit:banking`.

### `deposit_match_rules`

One row per restaurant, POS source, and rail. MVP rails: `card` only.

- `pos_source text` — an adapter name; the dispatcher rejects an unknown
  value;
- `rail` (`card`);
- `connected_bank_id` FK → `connected_banks`;
- `settlement` (`gross` | `net`);
- `lag_days_min`, `lag_days_max` (banking days);
- `fee_pct_min`, `fee_pct_max` (net rails; gross rails use 0-0);
- `amount_tolerance` (dollars) and `amount_tolerance_pct`;
- `source_config jsonb` — source-specific tender filters (example for
  `focus`: `{"card_tender_names": ["Visa","MC","Amex","Discover"]}`);
- `descriptor_pattern` (optional, case-insensitive);
- `active` flag.

A trigger checks that the `connected_bank_id` row belongs to the rule's own
`restaurant_id`. The FK alone does not check the tenant, and the refresh
function is SECURITY DEFINER — a cross-tenant bank id would expose another
restaurant's bank rows.

The setup dialog proposes defaults per source. A rule must exist before the
engine can mark an item `late` or `short`.

### `deposit_match_items`

One row per restaurant, rule, and business date. Unique on
`(restaurant_id, rule_id, business_date)`, so a refresh is idempotent.

- `expected_amount` (sum of card tenders for the date);
- `received_amount` (sum of confirmed links);
- `fee_amount` (net rails: `expected - received` when matched);
- `status`: `matched` | `matched_net` | `pending` | `late` | `short` | `over`
  | `needs_review` | `incomplete`;
- `status_reason` (machine-readable code, one per status decision);
- `resolution`: NULL | `accepted` | `disputed`, with `resolution_note`,
  `resolved_by`, `resolved_at`;
- `source_row_count` and `computed_at`.

A refresh updates the source-derived columns. A refresh never overwrites
`resolution`, `resolution_note`, or a manual link.

### `deposit_match_links`

Allocations between items and `bank_transactions`.

- `item_id` FK, `bank_transaction_id` FK, `allocated_amount`;
- `method` (`auto` | `manual`), `state` (`suggested` | `confirmed`),
  `match_reason`;
- unique on `(item_id, bank_transaction_id)`;
- an index on `(bank_transaction_id, state)` for the allocation-cap check.

A trigger keeps the sum of confirmed `allocated_amount` per bank transaction
at or below the transaction amount. The trigger first takes
`pg_advisory_xact_lock` on the bank transaction id, so two concurrent
confirms cannot both pass the sum check (pattern:
supabase/migrations/20260705130000_claim_open_shift_active_guard.sql:58).
Only confirmed links add to `received_amount`.

`bank_transaction_id` is `ON DELETE CASCADE`. A user can delete a bank
transaction elsewhere in the app. The cascade deletes the link, and the next
refresh recomputes `received_amount` and the status. The item's `resolution`
survives, because it lives on the item, not on the link.

## Matching engine

One SQL function: `refresh_deposit_matches(p_restaurant_id, p_start_date,
p_end_date)`. SECURITY DEFINER with `SET search_path = public`. The first
statement checks `view:banking` AND `view:pos_sales` with
`user_has_capability`, before any data read. Every new function (refresh,
report, dispatcher, adapters) states `SECURITY DEFINER SET search_path =
public`; the read-only ones are also `STABLE`. Every read of
`bank_transactions` and of the POS tables filters on
`restaurant_id = p_restaurant_id`, as defense in depth on top of the rule's
`connected_bank_id`.

A future cron caller has no `auth.uid()`, so `user_has_capability` returns
FALSE for it. A cron needs one auth change later: a service-role clause in
the check. The schema needs no change for a cron.

The refresh visits EVERY rule of the restaurant, not only the active ones:

- an inactive rule does not run the match steps; the refresh sets its items
  to `incomplete` with `status_reason = 'rule_inactive'`;
- each rule runs inside its own `BEGIN ... EXCEPTION` block. One bad rule
  (example: an unknown `pos_source`) cannot abort the refresh of the other
  rules. The failure lands in the report as `status_reason = 'rule_error'`.

The dispatcher rejects an unknown `pos_source` with an explicit
`ELSE RAISE EXCEPTION` that names the bad value. An adapter raises when a
required `source_config` key is absent — a missing key must not read as a
zero card total, because a silent zero hides the exact shortfall this
feature exists to catch.

Steps per active rule:

1. Upsert items: call the dispatcher, which calls the rule's adapter. The
   adapter returns the card total per business date.
2. Collect candidate bank transactions: positive amount, `is_transfer` is not
   true, the rule's `connected_bank_id`, date inside
   `[business_date + lag_min, business_date + lag_max]`, and the descriptor
   pattern when set.
3. Build all candidate (item, transaction) pairs. Score each pair by amount
   fit: `abs(expected_or_net - amount)`. Assign the best-scored pairs first,
   one transaction per item. Do NOT assign greedily in date order. A greedy
   date-order pass lets an earlier day take the deposit that fits the next
   day exactly; the next day then shows a false shortfall. The auto-memory
   lessons file records this bug class on 2026-08-18 ("Greedy first-come
   matching steals a boundary resource from its true owner", PR #760); the
   entry is not yet in the repo copy of `memory/lessons.md`.
4. Auto-confirm a link only when the fit is exact (gross) or the implied fee
   sits inside `[fee_pct_min, fee_pct_max]` (net) AND no second candidate
   scores within the tolerance. An ambiguous pair becomes a `suggested` link
   and the item becomes `needs_review`.
5. Set the status:
   - `matched` / `matched_net`: received inside tolerance;
   - `short`: confirmed link exists, remainder outside tolerance;
   - `over`: received above expected, outside tolerance;
   - `pending`: no link, and `business_date + lag_max` is not past;
   - `late`: no link, `business_date + lag_max` is past, AND
     `connected_banks.data_current_through` covers the expected-by date;
   - `incomplete`: the bank is stale, disconnected, or the rule is inactive.
     A stale bank can never produce `late` or `short`.

The engine never deletes a confirmed manual link and never clears a
resolution. One exception: a bank transaction delete cascades to its links
(see the data model), and the next refresh recomputes the item.

## Read RPC

`get_deposit_match_report(p_restaurant_id, p_start_date, p_end_date)` returns
one JSONB payload: summary totals (expected, received, pending, fees,
needs-attention), per-rule stream totals, ledger rows with their links, and
the freshness boundary per bank. Authorization: same intersection check,
before any read. The client renders from this one payload and recomputes no
totals.

## Frontend

Route `/banking/deposit-match` inside `ProtectedRoute`, registered next to
`/banking` (src/App.tsx:415). The page guard also checks the capability
intersection with `usePermissions()` — the route wrapper alone is not enough.

Files:

- `src/pages/DepositMatch.tsx` — page, date-range control (7/30/90 days),
  tabs;
- `src/hooks/useDepositMatch.ts` — React Query hook, key
  `['deposit-match', restaurantId, start, end]`, `staleTime` 30000. Do not
  add `placeholderData`/`keepPreviousData` to this hook — on this key shape
  it shows the old restaurant's data during a switch
  (`memory/lessons.md:1895-1898`). The refresh RPC is a mutation, NOT part
  of the `queryFn`. One effect runs it once per `(restaurantId, range)`
  change; on success it invalidates the read key. The read query keeps
  `refetchOnWindowFocus: true`; a focus refetch re-runs only the read RPC,
  never the refresh;
- `src/types/depositMatch.ts` — payload and status contracts;
- `src/components/deposit-match/VerdictBanner.tsx` — one plain-language
  answer ("Aug 4 is short $745.68 from Shift4" / all-clear);
- `src/components/deposit-match/MoneyWaterfall.tsx` — POS card total =
  deposited + settling + fees + needs review;
- `src/components/deposit-match/AttentionQueue.tsx` — exceptions by urgency;
- `src/components/deposit-match/StreamCards.tsx` — one card per rule. The
  cards and the ledger tabs come from the report payload. The UI hardcodes
  no POS source name;
- `src/components/deposit-match/DailyLedger.tsx` — per-day rows with status
  chips, one tab per stream. The tabs come from a `.map()` over the payload
  streams. `activeTab` holds a dynamic stream id (string), not a literal
  union. The first stream is the default tab. When a refetch deletes the
  active stream, the tab state falls back to the first stream. Each
  `TabsTrigger` keys on the stream id;
- `src/components/deposit-match/ReviewDayDialog.tsx` — short days with an
  Accept / Dispute action per row (writes `resolution`);
- `src/components/deposit-match/DisputeDialog.tsx` — evidence table from the
  POS card tender rows, neighbor-day proof, "Copy as email" text. PDF export
  is out of scope for the MVP. ONE instance of each dialog renders at page
  level, driven by one `activeItem` state (CLAUDE.md Single Dialog Pattern).
  A ledger or review row sets the state; no dialog renders per row;
- `src/components/deposit-match/SetupDialog.tsx` — create or edit rules.
  Defaults for `focus` and `toast` come from the measured production
  behavior in this doc. Defaults for the other sources are labeled guesses;
  the dialog copy says "Suggested values — check them against your bank"
  for those sources. The dialog follows the CLAUDE.md dialog structure
  (icon box, `DialogTitle`, `DialogDescription`).

Style follows the CLAUDE.md Apple/Notion tokens. Status chips use semantic
tokens, not direct colors. All states render: loading skeleton, error, empty
(no rules / no bank / no POS), and all-clear. The ledger scrolls inside its
own container on narrow screens. Icon-only controls carry an `aria-label`.
The dialogs trap focus and return focus to the control that opened them
(the shadcn Dialog primitive provides both).

The mockup at `scratchpad/deposit-match.html` (published artifact) is the
approved visual reference.

## Cause attribution honesty

The review dialog labels a probable cause only when the engine confirms it
against the POS rows (example: a refund on that date). When no evidence
exists, the label is "unknown". The mockup's inferred labels do not ship.

## Testing

- pgTAP (`supabase/tests/`): RLS intersection incl. cross-restaurant denial;
  idempotent refresh; greedy-order regression (two adjacent days where the
  wrong-order assignment fails); stale bank never yields `late`/`short`;
  confirmed-allocation cap; resolution survives refresh; summary equals the
  ledger sum; one fixture per adapter (focus, toast, square, revel, shift4)
  with known card totals; the dispatcher rejects an unknown `pos_source`;
  an unconfirmed rule keeps items `incomplete`.
- Vitest (`tests/unit/`): status/fee helpers, hook query key, payload
  parsing.
- Playwright (`tests/e2e/`): open the page, set up a rule, see the ledger,
  accept a short day, verify the banking-only collaborator cannot open the
  route.

## Non-goals (MVP)

- Cash rail and manual amount adjustments.
- Clover card reconciliation, until normalized Clover tender rows exist.
- PDF dispute export (copy-as-email text ships instead).
- Nightly cron refresh — the page triggers the refresh RPC on load. A cron
  job can come later without a schema change.
- Bank-holiday calendars; `lag_days_max` absorbs them.
- Cross-restaurant aggregation.

## Risks

- **False alarms:** the freshness gate and the `incomplete` status block a
  `late`/`short` verdict on stale data.
- **Migration prefix collision:** check the prefix against the merge ref, not
  only the branch (`memory/lessons.md`, 2026-07-21 and 2026-08-04 entries).
- **Shared local Supabase:** sibling worktrees share one stack. Defer the
  pgTAP GREEN signal to CI on contention (`memory/lessons.md`, 2026-08-20).
