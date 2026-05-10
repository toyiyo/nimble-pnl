# Time-Off Manager UX Redesign + Notification Email Fix

**Status:** Draft
**Owner:** Jose M Delgado (jose.delgado@easyshifthq.com)
**Created:** 2026-05-10
**Branch:** `feature/timeoff-manager-ux`

## Problem

Two related issues hurt manager response time on time-off requests:

1. **UX — easy to miss new requests.** `TimeOffList` (rendered in
   `src/pages/Scheduling.tsx` under the "Time-Off" tab) shows pending,
   approved, and rejected requests in a single flat list ordered by
   `start_date` desc. A new pending request from today can land below an
   approved request whose start date is later, so it visually disappears.
   Approve/reject controls are also `opacity-0 group-hover:opacity-100`,
   hiding the primary action until the manager hovers — bad on touch and
   easy to overlook.
2. **Email — managers silently miss notifications.** The email log shows
   that a `New Time-Off Request` email is delivered to the *employee* who
   submitted it, but **no manager email is sent**. Root cause is in
   `supabase/functions/send-time-off-notification/buildEmails.ts`: the
   PostgREST embed `select('user_id, profiles:user_id(email)')` cannot
   resolve because `public.profiles` has zero foreign keys (verified with
   `pg_constraint`). PostgREST returns `profiles: null` for every row
   silently, `managersFound = 0`, no manager emails sent. This is the same
   failure mode as PR #477's original bug, just rerouted from `auth.users`
   to `profiles` — and the test mock didn't exercise the real PostgREST
   shape, so the regression went unnoticed.

## Goals

1. Pending requests are unmissable on the Time-Off tab. Decided requests
   stay accessible for audit but don't compete for attention.
2. Approve/reject actions are first-class buttons on pending rows.
3. Manager emails actually reach managers when a new request is created.
4. Add a regression test that would have caught the silent embed failure.

## Non-Goals

- No new notification channels (web push to managers, in-app bell, native
  push). Email-only on `created` for managers, as today, but actually
  working.
- No conflict detection on the time-off row (separate work; useful but
  out of scope).
- No bulk approve/reject. YAGNI for this iteration.
- No changes to the employee-facing time-off view in `EmployeePortal.tsx`
  (renders its own list independent of `TimeOffList`).

## Affected Surfaces

| File | Change |
|------|--------|
| `src/components/TimeOffList.tsx` | Rewrite: pending queue + collapsible decided history + new row layout |
| `src/pages/Scheduling.tsx` | Add `(N) pending` count badge on the Time-Off tab trigger, mirroring the Shift Trades pattern |
| `supabase/functions/send-time-off-notification/buildEmails.ts` | Replace broken PostgREST embed with a 2-step query |
| `tests/unit/buildEmails.test.ts` (or moved equivalent) | Add a test that exercises the shape `buildEmails` actually requests, so the embed-vs-2-step distinction can't regress silently |
| `tests/unit/TimeOffList.test.tsx` (new) | Cover pending vs decided segregation, count, empty states, action visibility |

## Architecture

### Manager view layout (`TimeOffList.tsx`)

```
┌─ Time-Off Requests ─────────────────────────────────────┐
│ ┌── Action needed · 3 ──────────────────────────────┐   │
│ │ • Shy harrison    • requested 2 days ago          │   │
│ │   May 31 – Jun 7   "Family wedding"  ▸            │   │
│ │                            [✓ Approve] [✕ Reject] │   │
│ │ • Aleah Holderread • requested 4 days ago         │   │
│ │   May 14            "Doctor"                       │   │
│ │                            [✓ Approve] [✕ Reject] │   │
│ └────────────────────────────────────────────────────┘   │
│                                                          │
│ ▶ Decided · 124      [ All  Approved  Rejected ]        │
│   (collapsed; expands on click)                          │
└──────────────────────────────────────────────────────────┘
```

Two stable internal sub-components, both pure presentational; data is
sourced from a single `useTimeOffRequests(restaurantId)` call at the
parent and partitioned by status:

- `<PendingQueue requests={pending} onApprove onReject onEdit onDelete />`
  — the focused "Action needed" card. Always rendered, even when zero
  (with an "All caught up" empty state). Sorted oldest-first
  (`created_at` asc) so the manager works the queue FIFO. Each row uses
  the new layout: avatar/initial → employee name + "requested N days ago"
  → date range + truncated reason → primary `Approve` / `Reject`
  buttons + secondary edit/delete (still hover-revealed because they're
  not the primary action). The 80-char reason preview expands on click.
- `<DecidedHistory requests={decided} onDelete />` — collapsible
  (`<Collapsible>`), default closed. Header shows total count. Internal
  filter chips for `All | Approved | Rejected`. Rows are read-only
  (status badge + delete) and dense.

### Tab badge (`Scheduling.tsx`)

Compute `pendingTimeOffCount = timeOffRequests.filter(r => r.status === 'pending').length`
in the same hook used by `TimeOffList` (lifted to the page so the badge
can read it without prop-drilling). Render a `<Badge>` next to "Time-Off"
with the same warning-tinted style as `pendingTradeCount`.

### Email fix (`buildEmails.ts`)

Replace:

```ts
const { data: managers, error } = await supabase
  .from('user_restaurants')
  .select('user_id, profiles:user_id(email)')
  .eq('restaurant_id', restaurantId)
  .in('role', ['owner', 'manager']);
```

with a two-step query:

```ts
const { data: rows, error: rolesErr } = await supabase
  .from('user_restaurants')
  .select('user_id')
  .eq('restaurant_id', restaurantId)
  .in('role', ['owner', 'manager']);

if (rolesErr) { managerLookupError = rolesErr.message; }
else if (rows?.length) {
  const userIds = rows.map(r => r.user_id);
  const { data: profileRows, error: profErr } = await supabase
    .from('profiles')
    .select('email')
    .in('user_id', userIds);
  if (profErr) { managerLookupError = profErr.message; }
  else {
    for (const p of profileRows ?? []) {
      if (p.email) { emails.push(p.email); managersFound++; }
    }
  }
}
```

Two-step is robust to FK absence and matches what already works elsewhere
in the codebase. We keep the existing `BuildEmailsInput` /
`BuildEmailsResult` shapes so callers don't change.

### Data flow

```
Manager opens Scheduling → Time-Off tab
  ↓
useTimeOffRequests(restaurantId)  ← React Query, staleTime 30s
  ↓
partition by status in TimeOffList
  ↓                                       ↓
PendingQueue (always rendered)     DecidedHistory (lazy, collapsible)
  ↓
Approve/Reject mutations → invalidate ['time-off-requests', restaurantId]
  ↓
Edge function `send-time-off-notification` (existing)
  ↓
buildEmails (FIXED: 2-step query) → resend.emails.send to managers + (if enabled) employee
```

## Error Handling & Empty States

- `loading` → existing `<Skeleton>` block.
- `error` (query) → keep current behavior of empty list (don't introduce
  a new error UI; that's a different epic).
- Zero pending → render `PendingQueue` with "You're all caught up" empty
  message inside the card so the absence of action is itself reassuring.
- Zero decided → `DecidedHistory` shows just the disclosure with `0` and
  is non-interactive.
- Email recipients `[]` → existing log line stays; we now log
  `managersFound: <count>` so prod telemetry distinguishes "no managers
  configured" from "lookup found managers but their profile rows were
  missing".

## Testing Strategy

### Unit (Vitest)

1. `tests/unit/buildEmails.test.ts` (existing — extend)
   - Stub `supabase.from('user_restaurants')` to return rows, then
     `supabase.from('profiles')` to return matching profile rows. Assert
     `emails`, `managersFound`, dedup behavior.
   - Stub the second call to return `null` profiles → assert
     `managerLookupError` is set, `emails` does not include managers.
   - **Regression guard:** the test wires the 2-step shape (two `.from`
     calls), not a single `.select(... profiles:user_id(email) ...)`
     embed. If someone re-introduces an embed, the test setup won't
     receive a second `.from('profiles')` call and the assertion will
     fail.

2. `tests/unit/TimeOffList.test.tsx` (new)
   - Renders pending queue with N pending items.
   - Decided section collapsed by default, expands on click.
   - Pending row shows visible Approve and Reject buttons (no hover
     required) — assert via `getByRole('button', { name: /approve/i })`.
   - Empty pending → "All caught up" present (`getByText` + role).
   - Days-pending counter renders correctly for fixed `createdAt`
     timestamps.

### Database (pgTAP)

Add `supabase/tests/build_emails_query.sql` covering the underlying
SQL the edge function relies on:
- Insert a restaurant, an owner row in `user_restaurants`, a profile.
- Run the same 2-step query the edge function will issue (as service
  role) and assert the email is returned. Catches FK / RLS regressions
  that would block the real call path.

### E2E (Playwright)

Defer (existing test coverage on this surface is thin and adding a full
manager flow blows scope). Add a Playwright scenario only if any of the
above tests indicate gaps.

### Manual verification

- Local: `npm run dev:full`, sign in as manager, submit a time-off
  request from the employee portal in another browser, verify (a) the
  pending queue shows it on top with action buttons visible, (b) the
  Time-Off tab badge increments, (c) Resend dashboard shows the email
  going to the manager profile email, not just the employee.

## Telemetry / Observability

- Keep the existing `console.log/console.warn` in
  `send-time-off-notification`. Add `requestId` and the action name to
  every log line so it's greppable in Supabase function logs.
- No new metrics — manager email delivery is already observable via
  Resend. We rely on it.

## Rollout

Single PR. No feature flag — the UI surfaces are scoped to the
Scheduling page Time-Off tab and the email function fix is a strict bug
fix. If anything regresses, revert is a single PR revert.

## Open Questions / Risks

- **Profiles FK missing.** The fact that `profiles` has zero foreign
  keys is a broader hygiene issue. Out of scope here; flag as a
  follow-up so PostgREST embeds can work in the future without surprise.
- **Stale React Query data on rapid approval.** Existing 30s
  `staleTime` is fine; no new race conditions introduced.
- **Permission-based visibility.** The current `TimeOffList` is
  rendered without role gating because the `Scheduling` page itself is
  manager-only. We rely on that and don't add a role check inside the
  component.

## Acceptance Criteria

- [ ] Time-Off tab in Scheduling shows a `(N) pending` badge when
      pending requests exist; hidden at 0.
- [ ] Pending requests render in a focused card at the top with always-
      visible Approve/Reject buttons.
- [ ] Decided requests live in a collapsible section below, default
      collapsed, with All/Approved/Rejected filter chips.
- [ ] Empty pending shows "You're all caught up".
- [ ] Manager email is delivered for `created` action (verified locally
      via Resend test mode or against staging).
- [ ] `buildEmails` test covers the 2-step query and would fail if a
      single-call embed is re-introduced.
- [ ] All existing tests pass; lint, typecheck, build green.
