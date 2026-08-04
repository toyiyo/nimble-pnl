# Cascading shift-template hour changes to linked shifts

**Date:** 2026-08-03
**Branch:** `feature/template-hours-cascade`
**Status:** design

## Problem

Editing a shift template's hours in the planner updates one row and nothing else.
`updateMutation` in [`useShiftTemplates.tsx:130-150`](../../../src/hooks/useShiftTemplates.tsx) writes
to `shift_templates` and returns. Shifts already generated from that template — linked by
`shifts.shift_template_id` — keep their old times forever.

Managers expect the opposite. They read the template as the source of truth for "the morning
shift is 8–4", so moving it to 9–5 should move the shifts. Today it silently doesn't, and the
divergence is invisible until someone shows up an hour early.

A blind cascade is not the fix either. The same query would stomp shifts a manager
deliberately hand-adjusted, rewrite times staff have already been told about, and reach into
past shifts that payroll has consumed.

So the change is two things: make the cascade happen, and make its blast radius legible
*before* the manager commits.

## Scope

**In:** `start_time` / `end_time` only.

**Out:** cascading `days[]` and `capacity`. Same shape, different consequences — removing a day
orphans shifts that no longer have a matching template day, and changing capacity forces an
open-spot recount. Both deserve their own buckets and their own copy. Noted as follow-up.

## Four buckets and one flag

Every shift with `shift_template_id = <template>` lands in exactly one of four **buckets**. The
order below is the precedence order; the first match wins.

| Bucket | Predicate | Cascade behaviour |
|--------|-----------|-------------------|
| **Past** | `start_time < now()` | Never touched. Payroll has seen these. |
| **Locked** | `locked = true` | Never touched. That flag exists to mean "hands off". |
| **Moves with template** | future, unlocked, restaurant-local time-of-day still equals the OLD template times | Cascaded. |
| **Your call** (drifted) | future, unlocked, times hand-edited away from the template | Opt-in only, per-shift checkbox. Never auto-stomped. |

Precedence matters at the `Past`/`Locked` boundary — a locked past shift reports as Past,
because that is the more informative reason to a manager reading the ledger.

**Already posted** is a *flag*, not a bucket: `is_published = true` on a shift that is about to
be cascaded. A published shift still moves, it just costs more to move — it raises severity and
unlocks the notify affordance. Published shifts in the Past and Locked buckets are irrelevant
to the flag, since those aren't moving.

`locked` and `is_published` are both real columns, added in
[`20251123000000_schedule_publishing.sql:1-6`](../../../supabase/migrations/20251123000000_schedule_publishing.sql).

## Drift detection is a timezone problem

`shifts.start_time` is `timestamptz`. `shift_templates.start_time` is a local `TIME`. Comparing
them requires knowing which wall clock to compare in, and it is the **restaurant's**, never
the browser's.

Two recent commits fixed exactly this class of bug — `4e293abc` (publish/unpublish week
bucketing) and `a28f0e9f` (shift creation anchoring). Getting it wrong here would produce
drift false-positives for any manager travelling, or any restaurant whose staff span
timezones: a shift that matches the template perfectly would show up in "Your call" and be
excluded from the cascade.

The comparison is therefore:

```
localTimeOfDay(shift.start_time, restaurantTz) === template.start_time (old)
```

The SQL side already has the idiom, at
[`20260720120000_shift_fill_by_assignment.sql:77,99-100`](../../../supabase/migrations/20260720120000_shift_fill_by_assignment.sql):

```sql
(s.start_time AT TIME ZONE p_tz)::time AS local_start
```

and the write side at the same file, lines 417-418:

```sql
v_shift_start := (p_shift_date || ' ' || v_template.start_time)::timestamp AT TIME ZONE v_tz;
```

The TS side uses `formatLocalHHMMInTz` and `wallClockToInstant` from
[`src/lib/shiftInterval.ts`](../../../src/lib/shiftInterval.ts) (lines 234 and 336). Midnight-crossing
shifts are already solved by the `ShiftInterval` class in that file — reuse it, do not
reimplement the end < start arithmetic.

`restaurantTimezone` is already resolved in the planner at
[`ShiftPlannerTab.tsx:126`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx) via `safeTz(selectedRestaurant?.restaurant?.timezone)`.

## Architecture

Three units, each independently testable.

### 1. `useTemplateLinkedShifts(templateId, restaurantId)` — data

One React Query read. Returns every shift linked to the template with just the fields the
buckets need: `id, start_time, end_time, is_published, locked, employee_id`, plus the employee
name for the drift list.

Critically, this query **does not depend on the new times**. The manager typing in a time input
must not fire a network request per keystroke. Fetch once on dialog open; recompute buckets in
memory.

Follows the shape of the sibling impact hook
[`useTemplateDeletionImpact.ts`](../../../src/hooks/useTemplateDeletionImpact.ts): `staleTime: 30000`,
`refetchOnMount: 'always'` so a stale cached list can't understate the blast radius.

### 2. `bucketTemplateShifts(...)` — pure

```ts
bucketTemplateShifts({
  shifts, oldStart, oldEnd, newStart, newEnd, tz, now
}): TemplateHoursBuckets
```

No React, no supabase. Takes already-fetched rows and returns the four buckets, the
published-shift flag set, and the
scheduled-hours delta. This is where the timezone reasoning lives, and it is exhaustively
unit-testable — including the cases that are painful to reach through the UI: DST boundaries,
midnight-crossing shifts, a restaurant tz different from the test runner's tz.

### 3. `buildHoursChangeLedger(...)` — pure copy

Lives alongside [`deletionCopy.ts`](../../../src/lib/scheduling/deletionCopy.ts) and reuses its
exported `Severity`, `LedgerTone`, `LedgerChip`, `LedgerLine` types. Returns chips, lines, and
severity for the dialog to render dumbly.

Severity keys on `is_published`, not on raw count. The reasoning is the same as
`deriveTemplateSeverity` keying on pending claims
([`deletionCopy.ts:47-49`](../../../src/lib/scheduling/deletionCopy.ts)): a posted shift is a promise made
to a person, and forty unposted shifts are less consequential than one posted one.

## The dialog

The impact preview lives **inside** [`TemplateFormDialog.tsx`](../../../src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx),
recomputing live as the time inputs change — not as a second confirmation dialog after save.
A confirmation dialog arrives after the manager has already decided; an inline ledger informs
the decision while it is still being made.

Visually it is a sibling of [`DeleteTemplateDialog.tsx`](../../../src/components/scheduling/DeleteTemplateDialog.tsx):
same `SeverityPill` ([`SeverityPill.tsx`](../../../src/components/scheduling/SeverityPill.tsx)), same
tone-coded chip row, same Removed/Kept two-panel split (here: "Changes" / "Untouched").
Edit and delete should feel like the same product.

**Delta framing over counts.** The header shows the old range struck through, an arrow, the new
range, and a badge reading `+1h later` or `same length`. A manager reasons about "everyone
starts an hour later", not about "23 rows affected".

**Scheduled-hours delta, no dollars.** `+6.5 scheduled hours this week`. A cost figure is *not*
shown: `employees.compensation_type` is one of `('hourly','salary','contractor','daily_rate')`
([`20260114000000_add_daily_rate_compensation.sql:20`](../../../supabase/migrations/20260114000000_add_daily_rate_compensation.sql)),
and `hourly_rate` — though `NOT NULL` — is meaningless for three of those four. In a P&L
product, a dollar total that silently omits salaried staff is worse than no dollar total.
Cost can follow once there is a shared labor-cost helper that respects `compensation_type`.

**Two save buttons, not a radio group.** Secondary `Template only` (today's behaviour, still
legitimate — e.g. fixing a typo in a template you're about to retire) and primary
`Save & update N shifts`. Radio-then-confirm makes the manager state an intent and then
confirm it; two buttons let the choice and the commit be one gesture.

**No acknowledgement checkbox.** The delete dialog needs one because its cascade is
irreversible. This one isn't — so the guardrail is Undo, not friction.

**Drift disclosure.** The "Your call" bucket renders collapsed behind a disclosure showing the
count. Expanding lists each drifted shift with who's on it, its date, and its current time,
each with an unchecked checkbox. `aria-expanded` on the trigger, `aria-controls` pointing at
the panel, a real `<label>` per checkbox naming the employee and date.

Styling follows the Apple/Notion conventions in `CLAUDE.md` — semantic tokens only,
`border-border/40`, `bg-muted/30`, `rounded-xl` containers, the documented type scale.

While here, fix the pre-existing a11y defect at
[`TemplateFormDialog.tsx:128`](../../../src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx): the subtitle is a plain
`<p>` where it should be `<DialogDescription>`, so Radix never wires `aria-describedby`. This
is the same defect the CLAUDE.md dialog snippet explicitly calls out.

Note this is a different surface from [`BulkEditShiftsDialog.tsx`](../../../src/components/scheduling/BulkEditShiftsDialog.tsx),
which edits a manually multi-selected set of shifts. That flow stays as it is.

## Server side

### Why an RPC

The cascade must be atomic. The entire complaint being fixed is "the template changed but the
shifts didn't" — shipping a client-side loop that can partially apply would reintroduce the
same inconsistency under a different trigger. A single `UPDATE ... WHERE id = ANY($1)` also
acquires all its row locks in one statement, which is the ordering guidance in
`lock-deadlock-prevention.md`, and keeps the transaction to milliseconds per
`lock-short-transactions.md`.

The template row and the shift rows are updated in the **same** RPC, so there is no window
where one has landed and the other hasn't.

### `update_shift_template_with_cascade`

```sql
update_shift_template_with_cascade(
  p_template_id       UUID,
  p_restaurant_id     UUID,
  p_name              TEXT,
  p_position          TEXT,
  p_area              TEXT,
  p_days              INTEGER[],
  p_break_duration    INTEGER,
  p_capacity          INTEGER,
  p_start_time        TIME,
  p_end_time          TIME,
  p_cascade           BOOLEAN,
  p_drifted_shift_ids UUID[]   -- drifted shifts the manager opted into
) RETURNS JSONB
```

Returns `{ batch_id, updated_count, published_shift_ids, skipped_count }`.

`p_cascade = false` reproduces today's behaviour exactly, which is what the `Template only`
button sends.

The RPC re-derives the buckets server-side from `p_start_time`/`p_end_time` and the template's
*current* stored times. It does not trust a client-supplied list of "shifts that match" —
only the opt-in drift list, and even those are re-validated as future+unlocked+linked before
being touched. This closes the TOCTOU window between the dialog's read and the save.

Mirrors the structure of `unpublish_schedule` in
[`20260802120000_schedule_retractions.sql:99-140`](../../../supabase/migrations/20260802120000_schedule_retractions.sql):
`SECURITY DEFINER`, `SET search_path = public, pg_temp`, an explicit authorization guard
raising `insufficient_privilege`, restaurant-timezone resolution with a validated fallback,
counts taken from `RETURNING` rather than `GET DIAGNOSTICS`, then
`REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated, service_role`, plus a
`COMMENT ON FUNCTION`.

### Authorization

Because the function is `SECURITY DEFINER` it bypasses RLS, so its guard must be **at least as
strict as the policy it replaces**. The `shifts` UPDATE policy currently requires:

```sql
user_has_capability(restaurant_id, 'edit:scheduling')
```

([`20260730150000_rewrite_collaborator_policies.sql`](../../../supabase/migrations/20260730150000_rewrite_collaborator_policies.sql)) — and the
`schedule_change_logs` INSERT policy requires the same, at line 95 of that file.

So the guard is `user_has_capability(p_restaurant_id, 'edit:scheduling')`, **not** a hardcoded
role array. This diverges deliberately from `unpublish_schedule`, which uses the coarser
`user_has_restaurant_access(p_restaurant_id, false)`; the capability check is the one that
matches what direct-table access would have enforced. Hardcoding `('owner','manager')` here
would silently strip access from `operations_manager` and the collaborator roles that the
2026-07-02 and 2026-07-23 migrations granted.

## Undo

### Why a batch column

`schedule_change_logs` today is `(id, restaurant_id, shift_id, employee_id, change_type,
changed_by, changed_at, before_data, after_data, reason)`
([`20251123000000_schedule_publishing.sql:23-34`](../../../supabase/migrations/20251123000000_schedule_publishing.sql)).
Nothing groups rows into a batch.

Keying Undo off `changed_at` instead was considered and rejected. `changed_at` defaults to
`NOW()`, which is `transaction_timestamp()` and therefore identical for every row one RPC
writes — so it *looks* like a batch key. It isn't one:

- **The table has no `shift_template_id`.** Scoping a revert to "this template's cascade" would
  have to join `shifts.shift_template_id`, a mutable column that a later edit can change and
  that the deletion cascade sets to NULL. A batch key that depends on data outside the log
  isn't a key.
- **Uniqueness isn't guaranteed.** Nothing stops another writer from logging in the same
  transaction, or two transactions from sharing a timestamp; those rows would be swept into
  the Undo.
- **A timestamp is not an identifier.** Per `schema-data-types.md`, overloading one as a key is
  the same class of error as storing a boolean in a `varchar`.

(For accuracy: `changed_at` *is* indexed, at line 45 of that migration — the objection is
identity, not scan cost.)

A client-side snapshot replay was also rejected: it dies on refresh, leaves no audit trail,
and can partially apply — all three unacceptable for a bulk time change in a payroll-adjacent
system.

### Schema

```sql
ALTER TABLE public.schedule_change_logs
  ADD COLUMN IF NOT EXISTS cascade_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_schedule_change_logs_cascade_batch
  ON public.schedule_change_logs (cascade_batch_id)
  WHERE cascade_batch_id IS NOT NULL;
```

The index is **partial**. The column is NULL for every row that isn't part of a cascade — which
is nearly all of them — so a partial index keeps it small and keeps the write cost off the
common logging path (`query-partial-indexes.md`).

The column is nullable with no default, so every existing row and every existing writer is
unaffected.

### `undo_template_hours_cascade(p_batch_id, p_restaurant_id)`

Reverts each logged shift from its `before_data`, and **skips any shift whose current times no
longer match the `after_data` that cascade wrote** — meaning someone changed it in between.
Blindly restoring those would destroy a newer, deliberate edit.

Returns `{ restored_count, skipped_count }`, and the toast says so plainly:
`Restored 12 shifts · 1 skipped (changed since)`. Same authorization guard as the cascade.

Surfaced via `ToastAction`, the pattern already used by `hideMutation` at
[`useShiftTemplates.tsx:192-199`](../../../src/hooks/useShiftTemplates.tsx).

## Notifications

`send-shift-notification` already handles `action: 'modified'` with a
`previousShift: { start_time, end_time, position }` payload
([`index.ts:24-28,57-63`](../../../supabase/functions/send-shift-notification/index.ts)) — the code
path exists and is currently unused. The only client caller today passes `'deleted'`, from
[`useShifts.tsx:390`](../../../src/hooks/useShifts.tsx).

So the cascade returns `published_shift_ids`, and the client fires one invoke per id,
fire-and-forget. Copy the error discipline from that delete call site verbatim: `invoke`
resolves with `{ data, error }` on HTTP failure rather than rejecting, so both the `.then`
error branch and `.catch` must be handled, and neither may surface to the caller.

Gated behind a `Notify N staff` checkbox that only renders when published shifts are actually
affected — checked by default, since a manager who moves a posted shift almost always wants
the person to know.

This is one invoke per shift. For a very large cascade that is a lot of function calls; a
batched digest endpoint is the right answer at that scale and is noted as follow-up rather
than built here.

## Error handling

| Failure | Behaviour |
|---------|-----------|
| RPC rejects (authz, constraint) | Nothing written — template and shifts both unchanged. Destructive-variant toast with the error. Dialog stays open so the input isn't lost. |
| Impact query fails | Ledger renders an error state; `Save & update` is disabled. `Template only` stays enabled — it needs no impact data. |
| Impact query still loading | Both save buttons disabled; skeleton in the ledger. Never show a count that is still resolving. |
| Notification invoke fails | Logged via `console.warn`, never surfaced. The cascade already succeeded; a failed email must not read as a failed save. |
| Undo finds shifts changed since | Reverts the rest, reports the skip count. |
| Template edited concurrently | RPC re-derives buckets from the stored times, so a stale dialog cascades against reality, and the returned counts — which drive the toast — are the true ones. |

## Testing

**pgTAP** (`supabase/tests/template_hours_cascade.test.sql`) — the authoritative layer:
- cascade moves matching future unlocked shifts; leaves past, locked, and drifted untouched
- opted-in drifted ids are moved; non-opted-in ones are not
- drift detection is correct for a restaurant whose timezone differs from the server's
- midnight-crossing shift keeps its duration
- `p_cascade = false` touches only the template row
- authorization: a user without `edit:scheduling` gets `insufficient_privilege`; a user from
  another restaurant cannot touch these rows
- one `cascade_batch_id` across all rows of one call; distinct across two calls
- undo restores `before_data`; undo skips a shift mutated after the cascade
- no existing test is made vacuous — `shift_template_capacity.test.sql` and
  `shift_fill_by_assignment.test.sql` are the neighbours and neither covers template updates

**Vitest** — the pure units:
- `bucketTemplateShifts` across all four buckets and the published flag, DST boundaries,
  midnight crossing,
  non-local restaurant timezone, empty input
- `buildHoursChangeLedger` chips/lines/severity, including severity flipping on `is_published`
- hours-delta arithmetic including the "same length, shifted later" case

**Playwright** — one path: edit a template's hours with linked shifts present, confirm the
ledger appears with correct counts, save with cascade, confirm the grid shows moved shifts.
Accessible selectors only (`getByRole`, `getByLabel`).

## Files

**New**
- `supabase/migrations/<ts>_template_hours_cascade.sql` — batch column, partial index, both RPCs
- `supabase/tests/template_hours_cascade.test.sql`
- `src/lib/scheduling/templateHoursBuckets.ts` — `bucketTemplateShifts`
- `src/lib/scheduling/hoursChangeCopy.ts` — `buildHoursChangeLedger`
- `src/hooks/useTemplateLinkedShifts.ts`
- `src/components/scheduling/ShiftPlanner/TemplateHoursImpact.tsx` — the ledger panel
- `tests/unit/templateHoursBuckets.test.ts`, `tests/unit/hoursChangeCopy.test.ts`

**Modified**
- `src/hooks/useShiftTemplates.tsx` — RPC-backed cascade mutation + undo, `ToastAction`
- `src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx` — ledger, two save buttons,
  `DialogDescription` fix
- `src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx` — the single call site at line 642
- `src/integrations/supabase/types.ts` — regenerated

## Follow-ups

1. Cascade `days[]` and `capacity` changes.
2. Batched notification digest for large cascades.
3. Labor-**cost** delta once a shared helper respects `compensation_type`.
