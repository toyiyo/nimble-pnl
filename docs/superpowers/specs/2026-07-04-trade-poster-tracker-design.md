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
- **`cutoffIso` is computed INSIDE `queryFn`** (`new Date(Date.now() - days*864e5)`),
  not in the query key — the key stays stable
  (`['my_trade_activity', restaurantId, employeeId, resolvedWithinDays]`) while
  every refetch (30s staleTime / focus) re-derives a fresh cutoff. This avoids
  both the frozen-`now` lesson and query-key churn.
- `enabled: !!restaurantId && !!employeeId`, `staleTime: 30000`,
  `refetchOnWindowFocus: true` (house pattern).
- Existing mutations already invalidate `['shift_trades']`; they must also
  invalidate `['my_trade_activity']` — add that key to the `onSuccess`
  invalidations of `useCreateShiftTrade`, `useCancelShiftTrade`,
  `useAcceptShiftTrade`, `useApproveShiftTrade`, `useRejectShiftTrade`, and
  `useDeleteShiftTrade` (all in the same file).

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
  - `manager_note` shown for rejected (existing blue-note pattern used in
    TradeApprovalQueue).
  - **Withdraw** button (`variant="outline"`, `text-destructive` accent) only
    when `status === 'open'`, opening ONE page-level confirm dialog
    (single-dialog pattern; `ConfirmTarget = { trade } | null`), confirming via
    `useCancelShiftTrade({ tradeId, employeeId })`. Disable confirm+trigger
    while `isPending`. Restore focus to the card section header on close.
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
