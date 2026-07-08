# Design: Poster status-tracker + send-shift-notification timezone fix

**Date:** 2026-07-04
**Branch:** `feature/trade-poster-tracker`
**Follow-up to:** PR #562 (manager cleanup) and PR #570 (area warnings)

## Part 1 — Poster status-tracker

### Problem

After posting a shift trade, the poster gets a toast and then silence.
`EmployeeSchedule.tsx` fetches only `pending_approval` trades involving the
employee, so:
- a freshly-posted `open` trade (no claimant yet) shows **nothing**;
- once a manager approves/rejects, the trade **vanishes** without the poster
  ever seeing the outcome or who took the shift.

The existing "Pending Trade Requests" card also conflates two roles — the
employee as *poster* and as *claimant* — with one generic "Pending Approval"
badge.

### Decisions

1. **Lifecycle coverage:** show the employee's trades in `open`,
   `pending_approval`, and recently-resolved `approved`/`rejected`.
   **Resolved window = 7 days from `reviewed_at`** so outcomes are seen but the
   list doesn't grow forever. `cancelled` is excluded (the poster withdrew it
   themselves — no news to deliver).
2. **One card, two labeled sections** replacing "Pending Trade Requests":
   - **"Posted by you"** — poster view with a 4-step progress stepper.
   - **"Claimed by you"** — claimant view (preserves today's visibility and
     adds the resolved outcome).
   Partition rule: poster = `offered_by_employee_id === me`; claimant =
   `accepted_by_employee_id === me && offered_by !== me`. Directed-at-me open
   trades are NOT shown here (they live in the Available Shifts feed).
3. **Withdraw** for the poster's own `open` trades via the existing
   `cancel_shift_trade` RPC / `useCancelShiftTrade` hook, behind a confirm
   dialog. On success the trade becomes `cancelled` → drops out of the query.

### Data — new hook `useMyTradeActivity` (in `src/hooks/useShiftTrades.ts`)

A dedicated hook rather than another optional param on `useShiftTrades` (whose
OR-filter also matches `target_employee_id`, which we do NOT want here):

```ts
useMyTradeActivity(restaurantId, employeeId, resolvedWithinDays = 7)
```

Query (same select/joins fragment as `useShiftTrades` — `offered_shift`,
`offered_by`, `accepted_by`):

```
.eq('restaurant_id', restaurantId)
.or(`offered_by_employee_id.eq.${employeeId},accepted_by_employee_id.eq.${employeeId}`)
.in('status', ['open', 'pending_approval', 'approved', 'rejected'])
.or(`reviewed_at.is.null,reviewed_at.gte.${cutoffIso}`)
.order('created_at', { ascending: false })
```

- Multiple `.or()` calls are AND-ed by PostgREST — unresolved trades have
  `reviewed_at = null` (kept), resolved ones are kept only within the window.
  The window is enforced **server-side** (bounded payload, no client growth).
  **(Frontend review, major):** this AND-of-two-OR-groups is the most fragile
  line in the hook — a future refactor merging both into ONE `.or()` with a
  comma would silently flip the semantics to OR. Add a code comment at the
  call site stating that the two `.or()` calls are intentionally separate and
  AND-ed, plus the unit test asserting both appear as sibling filters.
- **`cutoffIso` is computed INSIDE `queryFn`** (`new Date(Date.now() - days*864e5)`),
  not in the query key — the key stays stable
  (`['my_trade_activity', restaurantId, employeeId, resolvedWithinDays]`) while
  every refetch (30s staleTime / focus) re-derives a fresh cutoff. This avoids
  both the frozen-`now` lesson and query-key churn.
- `enabled: !!restaurantId && !!employeeId`, `staleTime: 30000`,
  `refetchOnWindowFocus: true` (house pattern).
- **Invalidation via ONE shared helper (frontend review, major):** instead of
  editing six `onSuccess` blocks to add a second key (drift-prone), add a
  module-level `invalidateShiftTradeQueries(queryClient)` in
  `useShiftTrades.ts` that invalidates `['shift_trades']`,
  `['marketplace_trades']`, and `['my_trade_activity']`, and call it from the
  `onSuccess` of all six mutations (`useCreateShiftTrade`,
  `useCancelShiftTrade`, `useAcceptShiftTrade`, `useApproveShiftTrade`,
  `useRejectShiftTrade`, `useDeleteShiftTrade`). This also de-duplicates the
  existing repeated invalidations. Mutations that additionally invalidate
  `['shifts']` keep that extra call.
- **Type note (frontend review, minor):** export a named
  `type ShiftTradeStatus = ShiftTrade['status']` from `useShiftTrades.ts`; the
  pure helper imports the type only (type-only import of a hook module is fine
  and keeps one source of truth).

### Pure helper — `src/lib/tradeStatusProgress.ts` (new, unit-tested)

Lives in `src/lib` (measured dir, per the Sonar-coverage lesson). No React, no
clock reads.

```ts
export type TradeStepState = 'done' | 'current' | 'upcoming' | 'rejected';
export interface TradeStep { key: 'posted' | 'claimed' | 'review' | 'transferred'; label: string; state: TradeStepState; }
export interface PosterTradeProgress {
  steps: TradeStep[];              // always 4, in order
  summary: string;                 // one-line status for aria + subtitle
  outcome: 'active' | 'approved' | 'rejected';
}
export function getPosterTradeProgress(trade: {
  status: ShiftTradeStatus;
  accepted_by?: { name: string } | null;
}): PosterTradeProgress
```

Mapping:
| status | steps | summary |
|---|---|---|
| `open` | Posted ✓ → Claimed (current, "Waiting for a claimant") → Review → Transferred | "Posted — waiting for a claimant" |
| `pending_approval` | Posted ✓ → Claimed ✓ ("Claimed by {name}") → Review (current) → Transferred | "Claimed by {name} — awaiting manager review" |
| `approved` | all ✓ (Transferred done) | "Approved — shift transferred to {name}" |
| `rejected` | Posted ✓ → Claimed ✓ → Review (rejected) → Transferred (upcoming) | "Rejected by manager" |

`accepted_by` null (ghost) degrades to "a teammate" in labels — never crashes.
State-machine note (confirmed in design review against the SQL): `rejected` can
only be reached from `pending_approval`, which atomically sets `accepted_by`,
so a rejected trade never has a null claimant — the "a teammate" fallback is
purely defensive. Self-accept is likewise blocked at the RLS layer; the
partition's `offered_by !== me` clause is a second, defensive guard.
Known interaction (accepted): a **ghost** `pending_approval` trade (claimant
employee deleted) renders to the poster as "Claimed by a teammate — awaiting
manager review" while the manager's queue has exiled it to "Needs cleanup"; it
resolves when the manager removes it. Acceptable — no special poster-side copy.

Claimant rows don't need the stepper; a small status line suffices:
`pending_approval` → "Awaiting manager approval"; `approved` → "Approved — this
shift is on your schedule"; `rejected` → "Declined" (+ `manager_note` if set).

### UI — `EmployeeSchedule.tsx`

Replace the "Pending Trade Requests" card with a **"My shift trades"** card
(rendered when the activity list is non-empty; keep the existing
gradient-free Apple/Notion patterns — `rounded-xl border-border/40`,
typography scale `text-[13px]/[14px]`, no new raw colors beyond the
established amber pattern):

- **Posted by you** section: each row keeps the existing date-block + position
  + time layout, adds:
  - A compact horizontal stepper (4 dots/segments with labels at
    `text-[11px]`), colored via semantic/amber/established tokens:
    done = `text-foreground`/filled, current = amber pattern, rejected =
    `text-destructive`. The stepper container gets
    `role="img"` + `aria-label={progress.summary}` (text alternative — the
    per-step dots are decorative, `aria-hidden`).
  - **Narrow widths / 200% zoom (frontend review, minor):** step labels are
    hidden below the `sm` breakpoint (dots-only) with `progress.summary`
    rendered as an adjacent visible `text-[12px] text-muted-foreground` line —
    so low-vision/zoomed users get the same information as screen-reader
    users, and labels never wrap awkwardly.
  - `manager_note` shown for rejected in a neutral `bg-muted/30 border
    border-border/40 rounded-lg p-2.5 text-[13px]` block prefixed "Manager
    note:" (frontend review, minor: no existing manager-note display pattern
    exists to copy — the TradeApprovalQueue blue block is for the employee's
    *reason*; do not invent a colored block for this).
  - **Withdraw** button (`variant="outline"`, `text-destructive` accent) only
    when `status === 'open'`, opening ONE page-level confirm dialog
    (single-dialog pattern; `ConfirmTarget = { trade } | null`), confirming via
    `useCancelShiftTrade({ tradeId, employeeId })`. Disable confirm+trigger
    while `isPending`.
  - **Focus restore (frontend review, minor):** a successful withdraw unmounts
    the row (and its Withdraw button), so Radix's default return-to-trigger
    would target a removed element. Use the `TradeApprovalQueue`
    `bulkRemoveBtnRef` pattern: a stable ref on the "Posted by you" section
    header, explicitly focused on dialog close (both cancel and success).
- **Claimed by you** section: existing row layout + the status line above +
  `manager_note` when rejected.
- Loading: existing `tradesLoading` skeleton behavior (card hidden while
  loading, as today). Error: hook exposes `error`; on error render nothing new
  (page already has toasts elsewhere) — but do NOT render an empty-looking
  card on error (warning-heuristics lesson: `!isError` guard before "empty"
  interpretations).
- Empty: card not rendered when zero rows (matches current behavior).

### Not touched

`TradeRequestDialog` (posting flow), manager `TradeApprovalQueue`, marketplace
pages, tab badges, schema/RLS (poster/claimant SELECT visibility already
covered by the employees-can-view-trades policy).

## Part 2 — `send-shift-notification` renders restaurant timezone

### Problem

`supabase/functions/send-shift-notification/index.ts` calls the shared
`formatDateTime(...)` with **no `timeZone`** for Start/End/Previous Start/
Previous End (lines ~170–181), so assigned/updated/removed-shift emails show
UTC times. The shared helper already accepts an optional IANA `timeZone` with
an invalid-value probe → UTC fallback (added in PR #562).

### Fix (mirrors PR #562)

1. `_shared/notificationHelpers.ts`: add
   `getRestaurantInfo(supabase, restaurantId): Promise<{ name: string; timezone: string }>`
   — selects `name, timezone`, falls back to `'Your Restaurant'` /
   `'America/Chicago'` (column default + sibling-function convention) on
   error/missing. Keep the existing `getRestaurantName` untouched (its other
   consumer is only the dead `index.refactored.ts`, but no need to churn it).
2. `send-shift-notification/index.ts`: replace the `getRestaurantName` call
   with `getRestaurantInfo`, then pass `info.timezone` to all four
   `formatDateTime` calls.

No config/verify_jwt changes; the function's auth/settings flow is untouched.

### Testing

- `tests/unit/notificationHelpers.getRestaurantInfo.test.ts` — mock the
  supabase builder: happy path returns `{name, timezone}`; error → both
  fallbacks; row with null timezone → `'America/Chicago'`. (`_shared/**` is
  vitest-coverage-excluded in both configs, so no gate impact — correctness
  test only, same posture as the PR #562 email test.)
- `tests/unit/tradeStatusProgress.test.ts` — all four status mappings, ghost
  `accepted_by`, step states/labels, summaries.
- `tests/unit/useMyTradeActivity.test.ts` — mock builder chain: asserts the
  two OR filters + status IN + order; window param in query key; disabled
  without ids.
- Existing mutation-invalidation tests extended for the new query key where
  such tests exist.

## Review notes folded in

- **Interpolation safety (Supabase review, minor):** both values interpolated
  into `.or()` strings are non-user-controlled — `employeeId` is a UUID from
  our own `employees.id`, `cutoffIso` is `Date.toISOString()` output (no
  commas/parens). Add a code comment saying so, since PostgREST treats commas
  and parens as syntax.
- **`manager_note` visibility (Supabase review, minor):** the existing SELECT
  policy is restaurant-scoped, so ANY active employee in the restaurant can
  already read every trade's `manager_note`/`reviewed_at` via existing
  queries. This feature changes what is *rendered*, not the exposure surface —
  no new access decision is being made here.
- **pgTAP for the RLS assumption (Supabase review, optional):** declined for
  this PR — the policy is pre-existing and unchanged, and this PR has no SQL
  diff; adding RLS tests for unchanged policies is a separate hardening pass.
- **Composite `(restaurant_id, status)` index (Supabase review, optional):**
  declined — `shift_trades` volume per restaurant is small; noted as a watch
  item if scale changes.
- **Style seam (frontend review, minor, accepted):** the new flat
  Apple/Notion card will sit next to the page's older gradient cards
  (Upcoming Shifts etc.), which are NOT in scope. The seam is an accepted,
  scoped trade-off — modernizing the rest of the page is a separate task.

## Decided trade-offs

- **7-day resolved window, server-side:** long enough to catch a weekly
  schedule rhythm; server-side so payload stays bounded. Not configurable —
  YAGNI until asked.
- **No stepper for claimant rows:** the claimant cares about one binary
  outcome, not the pipeline; a status line is clearer and cheaper.
- **New hook over param-extending `useShiftTrades`:** the existing OR-filter
  includes `target_employee_id` matches, which would pollute this view;
  a dedicated, precisely-filtered query is clearer than a flag matrix.
- **`getRestaurantInfo` alongside `getRestaurantName`:** avoids touching the
  dead refactored file's import; one live consumer switches over.
