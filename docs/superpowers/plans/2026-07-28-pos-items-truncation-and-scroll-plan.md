# Implementation plan — POS item dropdown truncation + unscrollable list

**Date:** 2026-07-28
**Branch:** `fix/pos-items-truncation-and-scroll`
**Design:** `docs/superpowers/specs/2026-07-28-pos-items-truncation-and-scroll-design.md`
**Status:** Plan

Every identifier below is a fictional placeholder, per the design doc's
Privacy section. No real tenant, person or item name enters any file,
fixture, commit message or the PR body.

## Shape of the change

Two independent bugs, four layers:

| Layer | Files | Bug |
|---|---|---|
| DB | 1 new migration, 1 new pgTAP test | 1 |
| Hook | `src/hooks/usePOSItems.tsx` | 1 |
| Selector | `src/components/SearchablePOSItemSelector.tsx`, `RecipeDialog.tsx`, `POSSaleDialog.tsx` | 1 |
| Overlay context | 1 new `ui/` file, 3 overlay wrappers, 8 comboboxes | 2 |

The two bugs are independent, so the tasks are ordered to keep the tree
green at every step rather than to interleave them.

---

## Task 1 — `search_pos_items` RPC (bug 1, server)

**Test first.** `supabase/tests/search_pos_items_test.sql`, pgTAP,
`BEGIN/plan(N)/finish()/ROLLBACK` per CLAUDE.md. Seed two tenants and two
principals; assert:

1. case-insensitive dedupe across `pos_sales` + `unified_sales`
2. ranking `sales_count DESC` with the `item_name ASC` tiebreaker
3. `p_search` filters to matching items
4. `p_search` is literal: a `%` in the term matches a literal `%`, not
   everything (also `_` and `\`)
5. `p_limit` clamps: `NULL` → 100, `0` → 100, negative → 100, `1000` → 500
6. `source` resolution (`pos_sales` wins when any contributing row is)
7. **`item_id` fallback:** newest row has `NULL` id, older row has a real
   id → the real id is returned. This is the `FILTER` clause; it fails
   without it
8. **cross-tenant isolation:** assert the *denied baseline first*
   (principal B gets 0 rows for tenant A), then that principal A does get
   rows — so the test cannot pass vacuously ([2026-07-13] lesson)
9. an item ranked beyond the 1000th raw sale row is still returned — the
   regression test for the reported bug

**Then** `supabase/migrations/20260728140000_search_pos_items.sql`:

- `CREATE INDEX IF NOT EXISTS idx_pos_sales_restaurant_id ON public.pos_sales(restaurant_id);`
- `CREATE OR REPLACE FUNCTION public.search_pos_items(p_restaurant_id uuid, p_search text DEFAULT NULL, p_limit int DEFAULT 100)` returning
  `(item_name text, item_id text, source text, sales_count bigint, last_sold date)`,
  `LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public`
- body exactly as specified in design §1: `UNION ALL`, explicit
  `restaurant_id = p_restaurant_id` filter, escaped `ILIKE`,
  `GROUP BY lower(item_name)`,
  `(array_agg(item_id ORDER BY sale_date DESC) FILTER (WHERE item_id IS NOT NULL))[1]`,
  `ORDER BY count(*) DESC, lower(item_name) ASC`,
  `LIMIT least(CASE WHEN coalesce(p_limit,0) < 1 THEN 100 ELSE p_limit END, 500)`
- `REVOKE ALL ON FUNCTION … FROM PUBLIC;` then `GRANT EXECUTE … TO authenticated;`

**Verify:** `npm run db:reset && npm run test:db` (reset is mandatory
whenever the migration file changes — [2026-07-13]).

**Also:** regenerate Supabase types so `rpc('search_pos_items')` is typed.

---

## Task 2 — `usePOSItems` → React Query (bug 1, client)

**Test first.** `tests/unit/usePOSItems.test.ts`:

- calls `search_pos_items` with `{ p_restaurant_id, p_search, p_limit }`
- maps the RPC row shape onto `POSItem` unchanged
- `enabled` is false and `loading` is false while `restaurantId` is null
  (the [2026-07-27] disabled-query trap — a disabled query reports
  `isLoading === false`)
- `loading` is true while a real fetch is in flight
- `error` is populated on RPC failure and `posItems` stays `[]`

**Then** rewrite the hook:

```ts
usePOSItems(restaurantId: string | null, opts?: { search?: string; limit?: number })
  → { posItems, loading, error, refetch }
```

`queryKey: ['pos-items', restaurantId, search, limit]`,
`enabled: !!restaurantId`, `staleTime: 30_000`,
`placeholderData: keepPreviousData`,
`loading: isLoading && !!restaurantId`. Drop the destructive toast in
favour of the exported `error` (design §2/§3).

**Verify:** `npm run test -- usePOSItems`, `npm run typecheck`.

---

## Task 3 — selector server-side search + selected-value fix (bug 1, UI)

**Test first.** `tests/unit/SearchablePOSItemSelector.test.tsx`:

- typing calls `onSearchChange` with the typed term
- no client-side filtering is applied to `posItems` (all supplied items
  render, even ones not matching the typed text — the server filters now)
- **the trigger renders `value` verbatim when `value` is absent from
  `posItems`** — the regression identified in design §3
- with `error` set, the empty state reads as a failure, not "no matches"

**Then:**

- add `onSearchChange?: (s: string) => void` and `error?: unknown` props
- delete the `filteredItems` filter (lines 39-43); keep
  `shouldFilter={false}`
- trigger falls back to `value` before the placeholder
- error branch in `CommandEmpty` with a retry affordance
- remove `overscroll-contain` + `WebkitOverflowScrolling` (lines 90-91)
- `RecipeDialog.tsx` owns a 250 ms debounced search term and passes it to
  `usePOSItems(restaurantId, { search })`, wiring `onSearchChange`/`error`
- `POSSaleDialog.tsx` switches to `usePOSItems(restaurantId, { limit: 500 })`
  — list mode, Fuse.js untouched (design "Decided trade-offs")

**Verify:** `npm run test`, `npm run typecheck`, `npm run lint`.

---

## Task 4 — scroll-lock context + `modal` on eight comboboxes (bug 2)

**Test first.** `tests/unit/scroll-lock-boundary.test.tsx`:

- `useInsideScrollLock()` is `false` with no provider
- `true` inside `DialogContent`, `SheetContent`, `AlertDialogContent`
- for **each of the eight comboboxes**: the Popover root resolves
  `modal === true` inside a `DialogContent` and `modal === false`
  free-standing (assert the resolved prop/behaviour, not source text —
  [2026-07-20])

**Then:**

- new `src/components/ui/scroll-lock-boundary.tsx` (context + provider +
  hook, default `false`)
- wrap content in `DialogContent` (`ui/dialog.tsx:30-52`), `SheetContent`
  (`ui/sheet.tsx:56-72`), `AlertDialogContent` (`ui/alert-dialog.tsx:28-44`)
- `modal={useInsideScrollLock()}` on all eight Popover roots (table in
  design §"Affected components")

**Verify:** `npm run test`, `npm run typecheck`, `npm run lint`.

---

## Task 5 — E2E (both bugs)

`tests/e2e/`, helpers from `'../helpers/e2e-supabase'`, accessible
selectors, `generateTestUser()`. Before writing, grep `tests/e2e/` for
existing POS-item locators that the new dropdown text would break
([2026-07-13]).

1. Recipe dialog → open POS item dropdown → dispatch a real wheel event
   over the list → assert `scrollTop` advanced (the only place bug 2 is
   provable; jsdom implements neither real layout nor a non-passive
   native wheel listener)
2. type a term matching an item outside the first 1000 sale rows → assert
   it appears (bug 1, end to end)
3. **free-standing regression guard:** open a combobox on the
   Transactions page → assert the page still scrolls behind it
4. nested-overlay criteria from design §4: Escape closes only the
   popover; outside-click does not close the dialog; focus returns to the
   trigger; `<body>` stays interactive afterwards — gate any
   close-then-interact step on `document.elementFromPoint`, never on
   visibility or a sleep ([2026-07-22])
5. mobile viewport re-run of (1), covering the
   `-webkit-overflow-scrolling` removal

**Verify:** `npm run test:e2e`. Confirm the dev server under test is this
worktree's own (`reuseExistingServer` + a hardcoded port can silently
adopt another worktree's server — [2026-07-22]).

---

## Phases 6–9 (per the development-workflow skill)

UI review → `code-simplifier` → parallel Phase 7a reviewers (security,
sound-logic, performance, maintainability, ocr-rules) + Codex adversarial
→ reply to every finding with a verdict → CodeRabbit → full verification
(`npm run test:all`, `typecheck`, `lint`, `build`) → PR → CI green.

## Definition of done

- [ ] `npm run test:db` green, including the item-beyond-row-1000 case
- [ ] `npm run test` green; new code meets the 80%-on-new-code gate with
      behavioural (not source-text) assertions
- [ ] `npm run test:e2e` green, including the wheel-scroll assertion
- [ ] `typecheck`, `lint`, `build` clean
- [ ] the reported item appears in the Recipe dialog dropdown with its
      true sales count
- [ ] the dropdown scrolls with a wheel/trackpad inside the dialog
- [ ] pages hosting free-standing comboboxes still scroll normally
- [ ] PII sweep clean across the branch diff **and** commit messages
      before push
- [ ] `main` never committed to; `progress.md` never staged
