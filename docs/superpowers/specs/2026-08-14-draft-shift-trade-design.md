# Design: Allow a draft shift to be offered for trade

Date: 2026-08-14
Branch: `feature/draft-shift-trade`
Status: Approved by the user in chat on 2026-08-14.

## 1. Goal

Let an employee and a manager offer a draft shift for trade. A draft shift has
`is_published = false`. Mark every draft trade as tentative in the UI and in
the notification. The tentative mark tells a coworker that the shift can still
change or disappear before publication.

## 2. Decisions from the brainstorm

The user made these decisions in chat:

1. **Both actors.** An employee can offer an own draft shift. A manager can
   offer the draft shift of a coworker.
2. **Notify and mark tentative.** Send the trade notification the same as
   today. Add a "tentative — draft schedule" label to the notification and to
   the trade card.
3. **Approval runs in draft.** The trade lifecycle does not wait for
   publication. A draft trade runs offer → accept → approve like any other
   trade.

## 3. Current state (verified against `main` at commit `67344689`)

Three gates block a draft trade today. No other gate exists.

1. **Employee UI gate.** `canTrade` requires `shift.is_published`
   (`src/components/employee/ShiftRow.tsx:132-133`).
2. **Manager UI gate.** The offer button renders only when
   `shift.is_published` is true (`src/pages/SchedulingShiftCard.tsx:220`).
3. **Manager RPC guard.** `create_shift_trade_for_employee` raises
   `Only a published shift can be traded`
   (`supabase/migrations/20260812120000_create_shift_trade_for_employee.sql:75-76`).

These facts support the design:

- The employee INSERT policy on `shift_trades` checks ownership only. It does
  not check `is_published`
  (`supabase/migrations/20260105000000_fix_shift_trades_rls.sql:8-25`).
  The employee path needs no migration.
- `approve_shift_trade` does not check `is_published`
  (`supabase/migrations/20260105000100_create_shift_trade_functions.sql`,
  hardened in
  `supabase/migrations/20260713010000_harden_accept_shift_trade.sql`; neither
  file contains `is_published`).
- `offered_shift_id` carries `ON DELETE CASCADE`
  (`supabase/migrations/20260104120000_create_shift_trades.sql:10`). When a
  manager deletes a draft shift, the database deletes the trade.
- The notification function selects `start_time, end_time, position` from the
  offered shift. It does not select `is_published`
  (`supabase/functions/send-shift-trade-notification/index.ts:334-338`).
- The self-scope read policy already lets an employee read a shift that a
  `shift_trades` row references, with no `is_published` filter
  (`supabase/migrations/20260805130000_self_scope_employee_reads.sql:71`).
  Draft-shift reads through a trade are an accepted residual risk there.
- The employee row already shows a `DraftBadge` with the text
  "Draft — not confirmed" for a draft shift
  (`src/components/employee/ShiftRow.tsx:91,155`).

## 4. History: this design reverses a gate from PR #744

PR #744 added the `is_published` guard to the manager RPC and to
`SchedulingShiftCard.tsx` as a P1 fix. The concern: a trade for a draft shift
notifies a coworker about a shift that can still change or disappear. The
retrospective is in `memory/lessons.md` under
"[2026-08-14] A new manager RPC must mirror EVERY guard".

This design lifts that guard on purpose, as a product decision. Three
mitigations answer the original concern:

1. A tentative label shows everywhere the draft trade shows.
2. `ON DELETE CASCADE` deletes the trade when the draft shift disappears.
3. The tentative state derives live from `offered_shift.is_published`. When
   the manager unpublishes the week, the label reappears.

## 5. Change set

### A. Relax the two UI gates

- Delete the `shift.is_published` term from `canTrade` in
  `src/components/employee/ShiftRow.tsx:132-133`. Keep `!!onTrade`,
  `!isCancelled`, and the `isFuture` check.
- Delete the `shift.is_published` term from the offer-button condition in
  `src/pages/SchedulingShiftCard.tsx:220`. Keep the `onOfferTrade` check and
  the status allow-list `('scheduled', 'confirmed')`.

### B. Relax the manager RPC

- Add one migration with `CREATE OR REPLACE FUNCTION
  create_shift_trade_for_employee`. The new body deletes the `is_published`
  guard. Keep the role check, the tenant check, the owner check, the status
  allow-list, the offerer-active check, and the `unique_violation` handler.
- Do not edit `20260812120000_create_shift_trade_for_employee.sql`.

### C. Derive the tentative signal

- Store nothing new. The tentative state is
  `offered_shift.is_published = false`, read at render time and at
  notification time.
- Publication flips the flag to true; the label clears without a write to
  `shift_trades`. Unpublication flips it back; the label reappears.

### D. Mark tentative in the UI

- The Trade button now appears next to the existing `DraftBadge` in
  `ShiftRow`.
- Add a small "Tentative — draft" badge to each trade card that renders an
  offered shift with `is_published = false`:
  - `src/components/schedule/TradeMarketplace.tsx`
  - `src/components/schedule/MyShiftTradesCard.tsx`
  - `src/components/schedule/TradeApprovalQueue.tsx`
- Use warning tokens for the badge, consistent with `DraftBadge`. Do not use
  direct colors.
- The trade queries in `src/hooks/useShiftTrades.ts` must select
  `is_published` in the `offered_shift` embed where they do not today.

### E. Mark tentative in the notification

- Add `is_published` to the `offered_shift` embed in
  `supabase/functions/send-shift-trade-notification/index.ts:334-338`.
- When `is_published` is false, add one line to the email body and to the push
  body: "Tentative: this shift is on a draft schedule and can still change."
- Do not change the recipient logic. An open trade still broadcasts to all
  active employees. A directed trade still notifies the target only.

## 6. Lifecycle (existing behavior, no new code)

| Event | Effect on an active draft trade |
|---|---|
| Manager publishes the week | Trade stays. The tentative label clears. |
| Manager unpublishes the week | Trade stays. The tentative label reappears. |
| Manager deletes the draft shift | The database deletes the trade (cascade). |
| Coworker accepts, manager approves | The shift moves to the coworker while in draft. |

## 7. Out of scope

- The accept, approve, reject, and cancel RPCs.
- All RLS policies.
- The status allow-list and tenant scope in the manager RPC.
- A hold-until-publish queue for notifications or approvals.

## 8. Tests

### Flip (draft rejected → draft allowed)

1. `tests/unit/ShiftRow.test.tsx:43-51` — "does not offer a Trade button on a
   draft shift" becomes "offers a Trade button on a draft shift".
2. `tests/unit/SchedulingShiftCard.offerTrade.test.tsx:70-79` — "hides the
   offer action for an unpublished draft shift" becomes "shows the offer
   action for an unpublished draft shift".
3. `supabase/tests/55_create_shift_trade_for_employee.sql:297-311` — Scenario
   14 becomes a success test: the RPC posts a draft shift and returns a UUID.
   The plan count stays correct after the flip.

### Add

1. pgTAP: the draft-shift trade row exists after the RPC call, with
   `status = 'open'`.
2. Unit: the "Tentative — draft" badge renders on a trade card when
   `offered_shift.is_published` is false, and not when true.
3. Unit: `ShiftRow` shows the `DraftBadge` and the Trade button together on a
   draft shift.
4. Notification: with `is_published = false`, the email body and the push body
   contain the tentative line; with true, they do not.

### Warning from the PR #744 retrospective, applied in reverse

`shifts.is_published` is `NOT NULL DEFAULT false`. After the guard flip, pgTAP
fixture rows that omit the column sit on the passing side. Run the whole
`55_create_shift_trade_for_employee.sql` file after the change, not only
Scenario 14.

## 9. Approach alternatives considered

1. **Relax the gates, derive tentative live (chosen).** Smallest change set.
   No schema change. The label self-corrects on publish and unpublish.
2. **Hold notifications until publish.** Quieter, but it needs a pending-queue
   and a publish-time flush. The user rejected this option in chat.
3. **Directed offers only in draft.** Fewer recipients, but an employee cannot
   post a draft shift to the whole team. The user rejected this option in
   chat.
