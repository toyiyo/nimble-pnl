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

All eight are fixed, since any of them can be (and several are) rendered
inside a Dialog.

## Design

### 1. `search_pos_items` RPC

New migration `supabase/migrations/20260728120000_search_pos_items.sql`
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
- Display name and `item_id` are taken from the most recent sale via
  `array_agg(… ORDER BY …)`; `item_id` prefers the most recent
  **non-null** value, preserving the existing fallback at
  `src/hooks/usePOSItems.tsx:57`.
- `source` is `'pos_sales'` when any contributing row came from that
  table, else `'unified_sales'` — preserving today's POS/Unified badge at
  `src/components/SearchablePOSItemSelector.tsx:123`.
- `ORDER BY count(*) DESC, lower(item_name) ASC` — the tiebreaker makes
  the order deterministic, which today's `sort()` at
  `src/hooks/usePOSItems.tsx:92` is not.
- `LIMIT greatest(1, least(coalesce(p_limit, 100), 500))` — clamped so a
  caller cannot request an unbounded (or negative) page.
- `GRANT EXECUTE … TO authenticated`.

**Measured cost** (`EXPLAIN ANALYZE`, production):

| Case | Rows scanned | Time |
|---|---|---|
| Tenant A, no search, top 500 | 22,810 | **92 ms** |
| Tenant B (largest), `ILIKE` search, top 100 | 69,601 | **156 ms** |

Both plans use the existing `idx_unified_sales_restaurant_id` index then
hash/group-aggregate. **No new index is warranted** — a `pg_trgm` GIN
index would speed the `ILIKE` case but adds write amplification to the
hottest ingest table in the system for a 156 ms debounced query. Declined
deliberately; revisit if tenants grow another order of magnitude.

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

The hook keeps returning `{ posItems, loading, refetch }` — `refetch` is
used at `src/components/POSSaleDialog.tsx:319`.

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
- Remove the two dead CSS workarounds left by prior attempts —
  `overscroll-contain` (line 90) and `WebkitOverflowScrolling` (line 91).
  `src/components/ui/command.tsx:63` already supplies the real overflow
  rule.

### 4. `modal` on all eight Popover roots

One-line change per component. No CSS changes.

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
- `p_limit` clamps (0, negative, > 500, `NULL`)
- `source` and `item_id` resolution (most recent non-null wins)
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
- `modal` is set on each of the eight Popover roots

Note the [2026-07-20] lesson: source-text assertions do **not** count
toward Sonar's 80%-on-new-code gate, so the hook needs genuine
behavioural coverage, not just string matching.

**Playwright E2E** (`tests/e2e/`) — required by the Phase 8 gate, and the
only place bug 2 is genuinely provable, since it needs real layout and a
real non-passive wheel listener that jsdom does not implement:

- open the Recipe dialog, open the POS item dropdown, dispatch a real
  wheel event over the list, assert `scrollTop` advanced
- assert an item outside the first 1000 sales rows is reachable by typing

The E2E must also confirm the modal Popover nested inside a modal Dialog
does not break focus or leave `pointer-events: none` stranded on `<body>`
— the [2026-07-22] lesson documents exactly that failure mode for nested
Radix modals, and it is the main risk this change carries.

## Risks

| Risk | Mitigation |
|---|---|
| Nested modal Popover-in-Dialog breaks focus return or strands `pointer-events: none` on `<body>` | E2E asserts close-then-interact; [2026-07-22] lesson gives the `elementFromPoint` gate |
| Debounced server search feels laggy | `keepPreviousData` + 250 ms debounce; measured server time 92–156 ms |
| `SECURITY INVOKER` returns 0 rows if called from a service-role/anon context | Both call sites use the authenticated browser client (`src/components/RecipeDialog.tsx:74`, `src/components/POSSaleDialog.tsx:84`); pgTAP pins the isolation behaviour |
| E2E locators keyed on old dropdown text break | [2026-07-13] lesson; grep `tests/e2e/` for existing POS-item locators before editing |
