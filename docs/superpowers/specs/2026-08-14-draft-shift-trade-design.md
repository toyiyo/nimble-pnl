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
   today. Mark the notification and the trade card as tentative. The exact
   strings: the UI badge in section 5D, the notification line in section 5E.
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

### 4.1 Accepted risk: pre-publish visibility of the draft shift

An open-marketplace draft trade makes the draft shift readable by every
active employee in the restaurant. The chain: the `shift_trades` SELECT
policy admits every active employee to an open trade
(`supabase/migrations/20260713000000_restrict_directed_shift_trade_visibility.sql:38-39`),
and the `shifts` SELECT policy then admits the same employees to the
referenced shift
(`supabase/migrations/20260805130000_self_scope_employee_reads.sql:66-74`).
The client query joins `start_time`, `end_time`, `position`,
`break_duration`, and `is_published` from the shift
(`src/hooks/useShiftTrades.ts:139-145,632-638`). The same query also reads
`reason`, `manager_note`, and the name and position of `offered_by`,
`accepted_by`, and `target_employee` from the `shift_trades` row itself
(`src/hooks/useShiftTrades.ts:125-163`).

This design accepts only the new part of that risk: the shift fields.
Before this design, `is_published = false` blocked a trade from existing at
all, so those shift fields stayed hidden until publication. The
`shift_trades` row fields — `reason`, `manager_note`, participant name, and
participant position — were already readable on any open trade before this
design. This design does not add, remove, or change access to those fields.

The basis for accepting the new part: the user chose "Notify and mark
tentative" in chat. The broadcast email for an open trade already shows the
shift's position, start time, and end time to every active employee
(`supabase/functions/send-shift-trade-notification/index.ts:187-200,398-400`).
`break_duration` is a benign scheduling detail. `is_published` drives the
tentative label and discloses no shift content on its own.

## 5. Change set

### A. Relax the two UI gates

- Delete the `shift.is_published` term from `canTrade` in
  `src/components/employee/ShiftRow.tsx:132-133`. Keep `!!onTrade`,
  `!isCancelled`, and the `isFuture` check.
- Rewrite the design comment at `src/components/employee/ShiftRow.tsx:125-128`.
  Today it names four draft signals, and one is "the missing Trade button".
  That signal disappears with this change. The new comment must name the
  three signals that remain: the dashed surface, the badge copy, and the
  muted type.
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
- Badge text, one string everywhere in the UI: **"Tentative — draft"**. The
  wording differs from `DraftBadge` ("Draft — not confirmed") on purpose.
  `DraftBadge` speaks to the shift owner. The tentative badge speaks to a
  different employee who considers the trade. It tells that employee the
  shift can still change.
- Add the badge to each list card that shows an offered shift with
  `is_published = false`:
  - `src/components/schedule/TradeMarketplace.tsx`
  - `src/components/schedule/MyShiftTradesCard.tsx`
  - `src/components/schedule/TradeApprovalQueue.tsx`
  - `src/pages/AvailableShiftsPage.tsx` — the `TradeCard` component
    (lines 68-186) shows `trade.offered_shift` and is routed. Without the
    badge here, an employee can accept a draft trade with no warning.
- Add the badge, or one equivalent inline warning line, inside the four
  confirm and approval dialogs. These are the point of commitment:
  - `src/components/schedule/TradeMarketplace.tsx:206-215` (accept-confirm)
  - `src/components/schedule/MyShiftTradesCard.tsx:267-278` (withdraw-confirm)
  - `src/components/schedule/TradeApprovalQueue.tsx:618-621` (cleanup-confirm)
  - `src/components/schedule/TradeApprovalQueue.tsx:837-851` (approve/reject)
- Use warning tokens for the badge, consistent with `DraftBadge`. Do not use
  direct colors. The badge must show visible text, not only an icon or a
  color.
- The trade queries in `src/hooks/useShiftTrades.ts` must select
  `is_published` in the `offered_shift` embed where they do not today. The
  three embeds: `src/hooks/useShiftTrades.ts:139-145`, `:243-249`, and
  `:632-638`. These three cover every current consumer.
- Add `is_published: boolean` to the two types that describe the embed:
  `ShiftTrade.offered_shift` (`src/hooks/useShiftTrades.ts:21-27`) and
  `TradeWithConflict.offered_shift`
  (`src/components/schedule/TradeMarketplace.tsx:32-38`).
- `src/pages/EmployeeShiftMarketplace.tsx` also renders `offered_shift`
  through the same hook, but no route or import references it. It is dead
  code and out of scope. A follow-up task can delete it.

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
| Approval while draft, audit log | `schedule_change_logs` gets no entry. The `log_shift_change()` trigger fires only when `OLD.is_published = true` (`supabase/migrations/20251123000000_schedule_publishing.sql:96-162`). The trigger already skips every draft edit. No code change. |

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
   Add one follow-up `is()` check that the trade row exists, on the pattern
   of Scenario 1 (`lives_ok` at lines 106-109, `is()` at lines 113-117).
   `SELECT plan(16)` at line 29 becomes `SELECT plan(17)`.

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

The same trap exists in the unit-test fixtures, with a different default.
The `offered_shift` fixtures in
`tests/unit/AvailableShiftsPage.tradeCard.test.tsx` omit `is_published`. In
TypeScript an omitted field is `undefined`, and `!undefined` is true, so a
badge check reads those fixtures as tentative. Set `is_published` on every
fixture in that file when the badge lands there.

## 9. Approach alternatives considered

1. **Relax the gates, derive tentative live (chosen).** Smallest change set.
   No schema change. The label self-corrects on publish and unpublish.
2. **Hold notifications until publish.** Quieter, but it needs a pending-queue
   and a publish-time flush. The user rejected this option in chat.
3. **Directed offers only in draft.** Fewer recipients, but an employee cannot
   post a draft shift to the whole team. The user rejected this option in
   chat.
