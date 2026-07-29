# POS item dropdown: row-cap truncation + unscrollable list

**Date:** 2026-07-28
**Branch:** `fix/pos-items-truncation-and-scroll`
**Status:** Design

## Privacy

The diagnosis behind this document was driven by production data. Every
tenant, item and account identifier here is a **fictional placeholder**:
"Tenant A" / "Tenant B" for restaurants, "«reported item»" for the menu
item the user reported missing. Row counts and timings are real
aggregates and contain no personal data. Do not reintroduce real names
into this doc, the plan, test fixtures, commit messages or the PR body.

## Problem

Two independent, concurrent defects in the "POS Item Name" combobox on
the Create/Edit Recipe dialog:

1. **Most POS items are invisible, and the sales counts shown are wrong.**
   The user reported that "«reported item»" does not appear in the
   dropdown. For the affected tenant, only 77 of 223 distinct items
   (35%) are reachable at all, and every displayed sales count is roughly
   20× too low.
2. **The dropdown cannot be scrolled with a mouse wheel or trackpad.**
   Keyboard arrows work; the wheel does nothing.

Both fail **silently** — no console error, no failed request. PostHog
shows zero exceptions on `/recipes` over 14 days, which is consistent
with (and explains the longevity of) two bugs that each produce a
successful-looking result.

## Root cause 1 — unbounded `select()` hits PostgREST's 1000-row cap

`usePOSItems` issues two **unbounded** selects and aggregates in the
browser:

- `src/hooks/usePOSItems.tsx:30-34` — `from('pos_sales').select(...)` with
  `.eq('restaurant_id', …)` and no `.limit()` and no `.order()`.
- `src/hooks/usePOSItems.tsx:37-41` — the same shape against
  `unified_sales`.
- `src/hooks/usePOSItems.tsx:47-92` — the results are counted into a
  `Map` keyed on `item_name.toLowerCase()` and sorted by `sales_count`.

PostgREST caps an unbounded response at `max-rows` (1000) and returns
**HTTP 200**. The client cannot distinguish a truncated page from a
complete one, so the hook aggregates over an arbitrary 1000-row window
and reports the result as the tenant's whole catalogue.

Measured on the affected tenant (Tenant A): 22,810 `unified_sales` rows,
0 `pos_sales` rows, 223 distinct items. Re-running the client-side
aggregation over only the first 1000 rows reproduces the reported
screenshot **exactly** — the same six items in the same order with the
same counts — while the true counts are ~20× higher. "«reported item»"
has 92 real sales (rank #2 by volume) and appears zero times inside that
1000-row window.

This failure mode is already known in this codebase. Two existing
migrations solve it with a server-side aggregate and say so in their
header comments:
`supabase/migrations/20251201100000_aggregate_pass_through_totals.sql:2`
and `supabase/migrations/20251202100000_aggregate_monthly_metrics.sql:2`
("…which hits Supabase's 1000 row limit"). This design follows that
established pattern.

### Why not "just aggregate and return everything"

Across all tenants the distinct-item counts are: max 1854, second 1820,
third 223. **Two tenants exceed 1000 distinct items**, so an RPC that
returned every aggregated item would re-enter the same cap it exists to
escape. The fix has to be search + top-N, not a bigger fetch.

## Root cause 2 — the Popover portals out of the Dialog's scroll-lock shard

This is a library-level interaction, not a CSS problem. The CSS is
already correct: `CommandList` carries `max-h-[300px] overflow-y-auto`
at `src/components/ui/command.tsx:63`, and the call site adds
`max-h-72 overflow-y-auto overscroll-contain` at
`src/components/SearchablePOSItemSelector.tsx:90`. Six prior CSS-only
attempts failed because none of them addressed the actual mechanism.

The chain:

1. Radix `Dialog` wraps its content in `react-remove-scroll` with
   `shards: [context.contentRef]`
   (`node_modules/@radix-ui/react-dialog/dist/index.mjs:108`). The shard
   is the *exemption list* — the subtree still allowed to scroll.
2. `PopoverContent` renders inside `PopoverPrimitive.Portal`
   (`src/components/ui/popover.tsx:16`), which attaches to
   `document.body` — **outside** the dialog's content subtree, therefore
   outside the shard.
3. `react-remove-scroll` registers a **bubble-phase, non-passive** wheel
   listener on `document`
   (`node_modules/react-remove-scroll/dist/es2015/SideEffect.js:132`).
   Its handler computes
   `shardNodes = shards.filter(node => node.contains(event.target))`
   and then
   `shouldStop = shardNodes.length > 0 ? shouldCancelEvent(…) : !noIsolation`
   (`SideEffect.js:96-100`).
4. For a wheel event over the dropdown, `shardNodes` is empty. Radix does
   not set `noIsolation`, so `shouldStop` is `true` and the event is
   `preventDefault()`ed. Every wheel tick over the list is cancelled.

Keyboard navigation is unaffected because `cmdk` handles `keydown`, which
this listener never touches — matching the reported symptom precisely.

**The fix:** Radix `Popover` defaults to `modal = false`
(`node_modules/@radix-ui/react-popover/dist/index.mjs:35`) and branches on
it at line 119 to pick `PopoverContentNonModal` or `PopoverContentModal`;
only the modal variant wraps its content in its own `RemoveScroll`
(line 134), which re-establishes a shard around the portalled content.
Setting `modal` on the Popover root is therefore the mechanism-level fix.

### Affected components

None of the eight comboboxes in the app sets `modal`
(`git grep "Popover modal" origin/main -- src` returns nothing):

| Component | Popover root |
|---|---|
| `src/components/SearchablePOSItemSelector.tsx` | :61 |
| `src/components/SearchableProductSelector.tsx` | :92 |
| `src/components/SearchableLocationSelector.tsx` | :84 |
| `src/components/SearchableSupplierSelector.tsx` | :89 |
| `src/components/PositionCombobox.tsx` | :90 |
| `src/components/LocationCombobox.tsx` | :71 |
| `src/components/AreaCombobox.tsx` | :82 |
| `src/components/banking/SearchableAccountSelector.tsx` | :109 |

### Why `modal` cannot simply be hardcoded on all eight

Design review caught this, and it is the single biggest correction to the
original design. `modal` would be set **inside each shared component**, so
it would apply to *every* call site of that component — not only the ones
rendered inside a Dialog. Several of these comboboxes are rendered
free-standing on a page, with no Dialog/Sheet/AlertDialog ancestor:

| Free-standing call site | Combobox |
|---|---|
| `src/pages/PrintChecks.tsx:575` | `SearchableAccountSelector` (page-level `<Table>` row) |
| `src/components/banking/TransactionCard.tsx:106` | `SearchableAccountSelector` (card on `src/pages/Transactions.tsx`) |
| `src/components/pos-sales/SaleCard.tsx:270` | `SearchableAccountSelector` (inline edit on `src/pages/POSSales.tsx`) |
| `src/components/ReceiptMappingReview.tsx:632` | `SearchableSupplierSelector` (body of `src/pages/ReceiptImport.tsx`) |
| `src/components/receipt/ReceiptItemRow.tsx:482` | `SearchableProductSelector` (same page) |
| `src/components/bulk-edit/BulkCategorizePanel.tsx` | `SearchableAccountSelector` (inside `BulkActionPanel.tsx`, documented at its lines 18-25 as an explicitly **non-blocking** slide-in) |

Verified: none of those six files imports a Dialog/Sheet/AlertDialog
wrapper.

`PopoverContentModal` wraps content in `RemoveScroll` with **no shards**
(`node_modules/@radix-ui/react-popover/dist/index.mjs:134`), plus
`hideOthers(content)` and `disableOutsidePointerEvents: true`. Hardcoding
`modal` would therefore mean: opening the account combobox on one row of
the Transactions page locks scrolling for the **whole page** and hides
every sibling row from assistive tech. That is a page-wide interaction
regression traded for a dropdown-scroll fix — not acceptable.

### The fix: `modal` follows the scroll-lock context

`modal` must be `true` exactly when the Popover is rendered inside a
scroll-locked overlay, and `false` otherwise. Rather than push that
decision onto every call site (which every future call site would have to
remember, and which review would have to police forever), the boundary
publishes it:

- A new `src/components/ui/scroll-lock-boundary.tsx` exports a context
  provider and a `useInsideScrollLock(): boolean` hook, defaulting to
  `false`.
- The three overlay wrappers are all ours, so each renders the provider
  around its content: `DialogContent`
  (`src/components/ui/dialog.tsx:30-52`), `SheetContent`
  (`src/components/ui/sheet.tsx:56-72`) and `AlertDialogContent`
  (`src/components/ui/alert-dialog.tsx:28-44`).
- Each of the eight comboboxes becomes
  `<Popover modal={useInsideScrollLock()} …>`.

This makes the behaviour correct by construction at every existing and
future call site, and it is directly unit-testable in jsdom (render the
combobox with and without a Dialog ancestor and assert the resolved prop)
— unlike the wheel behaviour itself, which is not.

`src/components/ui/drawer.tsx` (vaul) is **not** covered: no combobox is
currently rendered inside a Drawer, and vaul manages its own scroll lock
with a different mechanism. Out of scope, noted so the gap is deliberate
rather than forgotten.

## Design

### 1. `search_pos_items` RPC

New migration `supabase/migrations/20260728140000_search_pos_items.sql`
(prefix verified unique — the latest existing migration is
`20260724180300`, and a colliding 14-digit prefix breaks `db-start` for
every PR per the [2026-07-21] and [2026-07-23] lessons).

```sql
CREATE OR REPLACE FUNCTION public.search_pos_items(
  p_restaurant_id uuid,
  p_search        text DEFAULT NULL,
  p_limit         int  DEFAULT 100
)
RETURNS TABLE (
  item_name   text,
  item_id     text,
  source      text,
  sales_count bigint,
  last_sold   date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
```

**`SECURITY INVOKER`, deliberately.** Both source tables already carry
tenant-scoped SELECT policies keyed on `auth.uid()`:

- `unified_sales` —
  `supabase/migrations/20251031010736_41ce38d5-19a1-4945-8e83-c886ebc471f3.sql:13-17`
- `pos_sales` —
  `supabase/migrations/20250924235138_fff30200-3cac-4662-845b-5ee4ef343cc0.sql:150-157`

An invoker-rights function inherits both, so tenant isolation needs no
new guard and no new attack surface. This departs from the older
`get_pass_through_totals` family, which is `SECURITY DEFINER` with no
internal tenant guard — a posture the [2026-07-11] lesson (PR #597)
flags as fragile. `search_path` is pinned anyway, per [2026-07-20].

Per the [2026-07-02] multi-tenant lesson, the explicit
`restaurant_id = p_restaurant_id` filter is kept in the query body even
though RLS enforces it: RLS is the backstop, the filter is the stated
intent.

Body shape:

- `UNION ALL` over `pos_sales` (`pos_item_name`, `pos_item_id`) and
  `unified_sales` (`item_name`, `external_item_id`). Column types match
  exactly on both sides (`text`/`text`/`date`/`uuid`, verified against
  the live schema), so the union needs no casts.
- Search filter: `item_name ILIKE '%' || <escaped> || '%'`, where
  `<escaped>` backslash-escapes `\`, `%` and `_` so a user typing `%`
  searches for a literal `%`. `NULL` or blank search means "no filter".
- `GROUP BY lower(item_name)` for case-insensitive dedupe, matching the
  current client-side `Map` key at `src/hooks/usePOSItems.tsx:51`.
- Display name is taken from the most recent sale via
  `array_agg(… ORDER BY sale_date DESC)`.
- `item_id` **must** be
  `(array_agg(item_id ORDER BY sale_date DESC) FILTER (WHERE item_id IS NOT NULL))[1]`.
  The `FILTER` is load-bearing, not decoration. The client code it
  replaces only overwrites `item_id` on a strictly newer `sale_date`
  *and* falls back to the stored value when the newer row's id is null
  (`src/hooks/usePOSItems.tsx:55-58`), so a prior non-null id survives a
  newer null one. A plain `(array_agg(… ORDER BY sale_date DESC))[1]`
  would return `NULL` whenever the single most-recent contributing row
  happens to lack an id — a silent regression of exactly the fallback
  this bullet claims to preserve. Design review caught this; it gets its
  own pgTAP assertion.
- `source` is `'pos_sales'` when any contributing row came from that
  table, else `'unified_sales'` — preserving today's POS/Unified badge at
  `src/components/SearchablePOSItemSelector.tsx:123`.
- `ORDER BY count(*) DESC, lower(item_name) ASC` — the tiebreaker makes
  the order deterministic, which today's `sort()` at
  `src/hooks/usePOSItems.tsx:92` is not.
- **`p_limit` clamp, specified exactly** so the pgTAP edge-case test has a
  defined expected value instead of one invented at implementation time:
  `NULL`, `0` and negatives all fall back to the default **100**; values
  above 500 clamp to **500**. That is
  `least(CASE WHEN coalesce(p_limit, 0) < 1 THEN 100 ELSE p_limit END, 500)`
  — deliberately *not* `greatest(1, …)`, which would turn a `0` into a
  1-row page rather than the documented default.
- `REVOKE ALL ON FUNCTION public.search_pos_items(uuid, text, int) FROM PUBLIC;`
  then `GRANT EXECUTE … TO authenticated`. Postgres grants `EXECUTE` to
  `PUBLIC` by default on creation. There is no live bypass here — the
  function is `SECURITY INVOKER`, so an `anon` caller has a `NULL`
  `auth.uid()` and the underlying RLS returns zero rows — but the
  explicit `REVOKE` is the least-privilege default and costs one line.

**Measured cost** (`EXPLAIN ANALYZE`, production):

| Case | Rows scanned | Time |
|---|---|---|
| Tenant A, no search, top 500 | 22,810 | **92 ms** |
| Tenant B (largest), `ILIKE` search, top 100 | 69,601 | **156 ms** |

Both plans use the existing `idx_unified_sales_restaurant_id` index
(confirmed present in production) then hash/group-aggregate.

**Caveat on what those numbers actually measured.** Design review flagged
that the timings never exercised the `pos_sales` half of the `UNION ALL`,
and that is correct: `pos_sales` holds **0 rows across 0 tenants** in
production, and its only index is `pos_sales_pkey`. So the measured cost
is the `unified_sales` half alone (179,329 rows across 14 tenants
table-wide). Two consequences:

- **`pg_trgm` GIN is still declined** for `unified_sales`. That judgment
  rested on the half that *was* measured, and stands: it would speed the
  `ILIKE` case but adds write amplification to the hottest ingest table
  in the system for a 156 ms debounced query. Revisit if tenants grow
  another order of magnitude.
- **A plain btree on `pos_sales(restaurant_id)` is added** in the same
  migration:
  `CREATE INDEX IF NOT EXISTS idx_pos_sales_restaurant_id ON public.pos_sales(restaurant_id);`
  On an empty table this builds instantly and costs nothing, and it
  removes an unbounded seq-scan risk if that legacy write path is ever
  used again. This is not the `pg_trgm` trade-off in miniature — the
  write-amplification argument does not transfer to a single btree on a
  table with no writes.

`pos_sales` stays in the `UNION ALL` regardless: the current hook reads it
(`src/hooks/usePOSItems.tsx:30-34`), local dev and pgTAP fixtures can
populate it, and dropping it would be a behaviour change beyond this bug.

### 2. `usePOSItems` → React Query

Rewritten to call the RPC, per CLAUDE.md's no-manual-caching rule:

```ts
usePOSItems(restaurantId: string | null, opts?: { search?: string; limit?: number })
```

- `queryKey: ['pos-items', restaurantId, search, limit]`
- `enabled: !!restaurantId` — the house "waiting" signal ([2026-04-22]).
  Note the [2026-07-27] lesson: a *disabled* query reports
  `isLoading === false`, so the exported `loading` flag is
  `isLoading && !!restaurantId` to keep today's meaning for consumers.
- `staleTime: 30_000`, matching the CLAUDE.md guidance.
- `placeholderData: keepPreviousData` so the list does not blank out on
  every keystroke.
- The `POSItem` interface is unchanged, so neither consumer's rendering
  code needs to change shape.

The hook returns `{ posItems, loading, error, refetch }`. `refetch` is
used at `src/components/POSSaleDialog.tsx:319`; `error` is new, and feeds
the selector's error state (§3). It replaces the current destructive
toast at `src/hooks/usePOSItems.tsx:97-101`, which would otherwise fire
once per debounced keystroke while a connection is failing.

### 3. `SearchablePOSItemSelector` — server-driven search

The component receives `posItems` as a **prop** from `RecipeDialog`
(`src/components/RecipeDialog.tsx:464-473`); it does not call the hook
itself. It stays presentational and gains one optional callback:

```ts
onSearchChange?: (search: string) => void;
```

`RecipeDialog` owns the debounced (250 ms) search term and passes it to
`usePOSItems`. Changes inside the selector:

- Drop the client-side `filteredItems` filter
  (`src/components/SearchablePOSItemSelector.tsx:39-43`) — the server
  now filters. `Command` already has `shouldFilter={false}` (line 83), so
  no cmdk-level filtering has to be disabled.
- **Selected-value display fix.** `selectedItem` is looked up in
  `posItems` at line 45, and the trigger falls back to the placeholder
  when the lookup misses (lines 73-77). With a server-side top-N page the
  selected item may not be in the current page, which would silently blank
  the user's own selection. The trigger must render `value` directly when
  the lookup misses.
- **Explicit error state.** CLAUDE.md requires loading/error/empty, and
  today the component only receives a boolean `loading`. Since the search
  now hits the network on every debounced keystroke, an RPC or RLS
  failure must not render as an empty list — "no matches" and "the query
  failed" are different answers to the user and must look different. The
  hook therefore also exports `error`, the selector takes it as a prop,
  and `CommandEmpty` renders a distinct failure message (with a retry
  affordance calling `refetch`) when `error` is set. The existing
  destructive toast in the hook's catch block is dropped: a toast per
  keystroke on a flaky connection is its own bug.
- Remove the two dead CSS workarounds left by prior attempts —
  `overscroll-contain` (line 90) and `WebkitOverflowScrolling` (line 91).
  `src/components/ui/command.tsx:63` already supplies the real overflow
  rule. `-webkit-overflow-scrolling` is a no-op on modern iOS (momentum
  is the default since iOS 13) but the removal still gets a real
  mobile-viewport check in the E2E rather than an assumption.

### 4. Context-driven `modal` on all eight Popover roots

New file `src/components/ui/scroll-lock-boundary.tsx`; provider added to
`DialogContent`, `SheetContent` and `AlertDialogContent`; one-line change
per combobox (`modal={useInsideScrollLock()}`). No CSS changes beyond the
two dead rules removed in §3. Rationale and the free-standing call sites
this protects are in "Why `modal` cannot simply be hardcoded" above.

**Expected nested-overlay behaviour** — stated here as acceptance criteria
rather than left to "verify empirically", since these are the semantics
the E2E must assert:

- **Escape** dismisses only the Popover, not the Dialog. Radix's
  `DismissableLayer` picks the highest layer by index
  (`isHighestLayer = index === context.layers.size - 1`,
  `node_modules/@radix-ui/react-dismissable-layer/dist/index.mjs`), and
  the Popover mounts after the Dialog.
- **Outside click** inside the Dialog does not dismiss the Dialog. Radix
  tracks a `branches` set, so a nested layer is not treated as an outside
  click by the parent — the same mechanism that already makes
  `Select`-in-`Dialog` work today.
- **Focus** returns to the Popover trigger on close
  (`PopoverContentModal.onCloseAutoFocus`), which composes with the
  Dialog's `FocusScope` because the trigger is inside the trapped subtree.
- **`pointer-events: none`** is not stranded on `<body>`. The layer count
  is a shared set whose original value is captured only on the 0→1
  transition, so a Popover mounting under an already-open Dialog does not
  stomp it.

## Decided trade-offs

**POSSaleDialog keeps a list-based fetch, not server-side search.**
That dialog does not use `SearchablePOSItemSelector`. It merges POS items
with recipes into one list (`src/components/POSSaleDialog.tsx:144-184`)
and fuzzy-searches the union locally with Fuse.js (lines 188-200). A
top-N server page does not satisfy Fuse's need for the full corpus, and
converting that dialog to server-side search would mean redesigning how
its recipe and POS halves are searched together — well beyond the
reported bug.

It therefore calls `usePOSItems(restaurantId, { limit: 500 })` with no
search term. This is still a large correctness win: today it aggregates
an arbitrary 1000-row window (77 real items for Tenant A, with counts
~20× too low); afterwards it gets the true top 500 items ranked by true
sales volume. **Residual limitation:** for the two tenants with >1000
distinct items, a very rare item can still fall outside the top 500 in
that dialog. Accepted for this PR; a follow-up can convert it to
server-side search.

**Sales counts are lifetime, not windowed.** Both the current hook and
the RPC count every row ever recorded. Preserving existing behaviour;
adding a date window is a product decision, not a bug fix.

## Test strategy

**pgTAP** (`supabase/tests/`) — the RPC:

- case-insensitive dedupe across `pos_sales` + `unified_sales`
- ranking by `sales_count DESC` with the `item_name` tiebreaker
- `p_search` filters, and is treated as a literal (a `%` in the search
  term matches a literal `%`, not "everything")
- `p_limit` clamps: `NULL`/`0`/negative → 100 rows, `> 500` → 500
- `source` resolution
- **`item_id` resolution specifically:** an item whose most recent sale
  row has a `NULL` id but whose older row has a real id must return the
  older id, not `NULL` (the `FILTER` clause in §1)
- **cross-tenant isolation:** a user entitled to tenant A gets zero rows
  for tenant B. Per the [2026-07-13] lesson this must use a principal
  granted by *only* the clause under test, with a denied baseline
  assertion first, so the test cannot pass vacuously.

Per the [2026-07-13] lesson, `npm run db:reset` before `npm run test:db`
whenever the migration file is edited.

**Vitest** — the hook and the components:

- the hook calls `search_pos_items` with the expected args, and
  `enabled`/`loading` behave while `restaurantId` is null
- the RPC result maps onto `POSItem` unchanged
- the selector renders the raw `value` when it is absent from the current
  page (the regression identified in §3)
- the selector distinguishes "no matches" from "query failed"
- **`modal` resolution**, for each of the eight comboboxes: `true` when
  rendered inside a `DialogContent`, `false` when rendered free-standing.
  This is the unit-level guard for the critical design-review finding,
  and it is a genuine behavioural assertion rather than a source-text
  match.

Note the [2026-07-20] lesson: source-text assertions do **not** count
toward Sonar's 80%-on-new-code gate, so the hook needs genuine
behavioural coverage, not just string matching.

**Playwright E2E** (`tests/e2e/`) — required by the Phase 8 gate, and the
only place bug 2 is genuinely provable, since it needs real layout and a
real non-passive wheel listener that jsdom does not implement:

- open the Recipe dialog, open the POS item dropdown, dispatch a real
  wheel event over the list, assert `scrollTop` advanced
- assert an item outside the first 1000 sales rows is reachable by typing

- open a combobox on a **free-standing** page (Transactions) and assert
  the page still scrolls behind it — the regression guard for the
  hardcoded-`modal` mistake caught in design review
- a mobile-viewport run of the wheel/touch assertion, covering the
  `-webkit-overflow-scrolling` removal

The E2E must also confirm the four nested-overlay criteria listed in §4
(Escape dismisses only the Popover, outside-click does not close the
Dialog, focus returns to the trigger, `<body>` is left interactive).

**Correction to an earlier draft of this doc.** It cited the
[2026-07-22] "Radix modal Dialogs keep `pointer-events: none` on
`<body>`" lesson as documenting "exactly that failure mode for nested
Radix modals". It does not. Re-read at `memory/lessons.md:1489-1492`,
that lesson is about a **single** Dialog's *asynchronous teardown* after
its own close animation, fixed by gating a synthetic pointer interaction
on `document.elementFromPoint`. It says nothing about two Radix layer
contexts nested inside one another. The `elementFromPoint` gate is still
the right technique for any close-then-interact step in the new E2E — but
this specific nesting has **no** prior-incident coverage in our lessons,
which is an argument for asserting it explicitly, not for assuming it is
already understood.

## Risks

| Risk | Mitigation |
|---|---|
| Nested modal Popover-in-Dialog breaks focus return or strands `pointer-events: none` on `<body>` | §4 states the four expected behaviours as acceptance criteria, traced to the Radix layer source; E2E asserts each. The `elementFromPoint` gate from [2026-07-22] is the right tool for the close-then-interact step, but that lesson does **not** cover this nesting (see Test strategy) — so this is asserted, not assumed |
| `modal` regresses free-standing comboboxes (page scroll lock, `hideOthers` hiding sibling rows) | The whole reason `modal` is context-driven rather than hardcoded; unit test asserts both resolutions, E2E asserts the Transactions page still scrolls |
| `item_id` silently becomes `NULL` for items whose newest row lacks an id | `FILTER (WHERE item_id IS NOT NULL)` in §1, with a dedicated pgTAP assertion |
| Debounced server search feels laggy | `keepPreviousData` + 250 ms debounce; measured server time 92–156 ms |
| `SECURITY INVOKER` returns 0 rows if called from a service-role/anon context | Both call sites use the authenticated browser client (`src/components/RecipeDialog.tsx:74`, `src/components/POSSaleDialog.tsx:84`); pgTAP pins the isolation behaviour |
| E2E locators keyed on old dropdown text break | [2026-07-13] lesson; grep `tests/e2e/` for existing POS-item locators before editing |

## Design review (Phase 2.5)

Two reviewers ran against the committed design before any code was
written. Both premise-checked every `file:line` citation in this doc; no
citation was found to be inaccurate. Dispositions:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | critical | Hardcoding `modal` on all eight comboboxes regresses six free-standing call sites (page-wide scroll lock + `hideOthers`) | **Accepted — design changed.** `modal` is now context-driven via `useInsideScrollLock()`. Verified the six sites import no overlay wrapper |
| F2 | critical | The [2026-07-22] lesson was mischaracterized as covering nested Radix modals | **Accepted — corrected.** Re-read `memory/lessons.md:1489-1492`; it covers a single Dialog's async teardown. Correction recorded in Test strategy |
| S1 | major | Perf measurement never exercised the `pos_sales` half; no `restaurant_id` index exists there | **Accepted — verified and fixed.** Production `pos_sales` is empty (0 rows / 0 tenants, only `pos_sales_pkey`). Added a free btree; `pg_trgm` still declined for `unified_sales` |
| S2 | major | `array_agg(...)[1]` for `item_id` returns `NULL` when the newest row's id is null, regressing the client fallback | **Accepted.** `FILTER (WHERE item_id IS NOT NULL)` is now specified and separately tested |
| F3 | major | No error state designed for the new per-keystroke network call | **Accepted.** Hook exports `error`; selector distinguishes failure from empty; per-keystroke toast dropped |
| F4 | major | Nested-overlay behaviour left as "verify empirically" with no stated expectation | **Accepted.** §4 now states four acceptance criteria traced to the Radix layer source |
| S3 | minor | `greatest(1, …)` floors `p_limit = 0` to a 1-row page, undocumented | **Accepted.** Clamp respecified: `NULL`/`0`/negative → 100, `> 500` → 500 |
| S4 | minor | No `REVOKE ... FROM PUBLIC` alongside the `GRANT` | **Accepted.** Added; no live bypass existed (`SECURITY INVOKER` + RLS), taken as least-privilege hygiene |
| F5 | minor | Removing `-webkit-overflow-scrolling` needs a real mobile check, not an assumption | **Accepted.** Mobile-viewport assertion added to the E2E plan |

Also confirmed by review and requiring no change: `SECURITY INVOKER` is
sufficient (both RLS SELECT policies are the live, never-redefined,
`auth.uid()`-scoped definitions, backed by the `user_restaurants`
unique index); `UNION ALL` column types match with no casts; the
migration prefix is unique; `STABLE` and the pinned `search_path` are
correct; the wheel behaviour genuinely cannot be tested in jsdom;
outside-click for a nested layer is already handled by Radix's `branches`
set; and the existing `role="combobox"` / `aria-expanded` affordances
survive the rework.
