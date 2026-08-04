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

The SQL side already has the read idiom, at
[`20260720120000_shift_fill_by_assignment.sql:99-100`](../../../supabase/migrations/20260720120000_shift_fill_by_assignment.sql):

```sql
(s.start_time AT TIME ZONE p_tz)::time AS local_start
```

The TS side uses `formatLocalHHMMInTz` and `wallClockToInstant` from
[`src/lib/shiftInterval.ts`](../../../src/lib/shiftInterval.ts) (lines 234 and 336). Midnight-crossing
shifts are already solved by the `ShiftInterval` class in that file — reuse it, do not
reimplement the end < start arithmetic.

`restaurantTimezone` is already resolved in the planner at
[`ShiftPlannerTab.tsx:126`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx) via `safeTz(selectedRestaurant?.restaurant?.timezone)`.

### Writing the new times: reconstruct, never offset

Two formulas are available for the cascaded times and they disagree on DST days.

**Rejected** — interval arithmetic: `new_start = old_start + (new_template_start - old_template_start)`.
Simple, and wrong whenever the shift's own date crosses a spring-forward or fall-back
boundary; it preserves the elapsed *duration* rather than the *wall clock*, which is the
opposite of what a manager setting "9am" means.

**Required** — reconstruct from parts, reusing the write-side idiom at
[`20260720120000_shift_fill_by_assignment.sql:417-418`](../../../supabase/migrations/20260720120000_shift_fill_by_assignment.sql):

```sql
v_local_date  := (s.start_time AT TIME ZONE v_tz)::date;   -- the shift's own restaurant-local day
v_shift_start := (v_local_date || ' ' || p_start_time)::timestamp AT TIME ZONE v_tz;
v_shift_end   := (v_local_date || ' ' || p_end_time)::timestamp   AT TIME ZONE v_tz;
IF v_shift_end <= v_shift_start THEN
  v_shift_end := v_shift_end + INTERVAL '1 day';           -- midnight crossing, per lines 419-422
END IF;
```

This matches the DST semantics that `parseWallClock`
([`src/lib/restaurantClock.ts:192-259`](../../../src/lib/restaurantClock.ts)) implements client-side
and that [`supabase/tests/wall_clock_parity.sql`](../../../supabase/tests/wall_clock_parity.sql) pins,
so the preview and the write agree on the hard days.

### One fallback timezone, not two

`restaurants.timezone` is `TEXT DEFAULT 'America/Chicago'` and **nullable**
([`20251001022351_...sql:3`](../../../supabase/migrations/20251001022351_2147ffdb-edc4-4d22-8812-8120871aaf6f.sql)),
so the null path is reachable, not dead code.

Today the two layers disagree on what to do about it. The client's `safeTz` falls back to
`DEFAULT_TIMEZONE = 'America/Chicago'`
([`src/lib/restaurantClock.ts:13,77`](../../../src/lib/restaurantClock.ts)), while every server-side
scheduling function COALESCEs to `'UTC'` — six of them, including
[`20260802120000_schedule_retractions.sql:129`](../../../supabase/migrations/20260802120000_schedule_retractions.sql).
For a restaurant with a null timezone the client preview and the server's re-derived buckets
would land in different hours, manufacturing exactly the drift false-positives this section
exists to prevent.

These RPCs therefore fall back to **`'America/Chicago'`**, matching the client and the column
default, with an inline comment recording the deliberate divergence from the `'UTC'` siblings.
Changing those six to match is a follow-up, not this PR — they are correct relative to each
other and retiming them is its own blast radius.

(For the record, the comment at
[`ShiftPlannerTab.tsx:120-126`](../../../src/components/scheduling/ShiftPlanner/ShiftPlannerTab.tsx)
asserting that "every server-side scheduling function COALESCEs a null to 'America/Chicago'"
is currently false. Correct it while here.)

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
scheduled-hours delta. The drifted bucket is typed `DriftRow[]` (see *The dialog* below) —
already carrying restaurant-local date and time strings, so no component downstream has to
touch a timezone. This is where the timezone reasoning lives, and it is exhaustively
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

### Layout

The ledger renders **below** the Start/End time inputs and **above** Position — adjacent to the
control that causes it, so cause and effect are visible together — and is collapsed by default
to a single summary row (severity pill + delta + "N shifts affected"). Expanding reveals the
chips and the Changes/Untouched panels.

The footer must become sticky. `TemplateFormDialog` currently ends with a plain
`<div className="flex justify-end gap-2 pt-2">` *inside* the scrollable form
([`TemplateFormDialog.tsx:296`](../../../src/components/scheduling/ShiftPlanner/TemplateFormDialog.tsx)),
which already differs from the shipped sibling. Adopt the exact pattern from
[`DeleteTemplateDialog.tsx:245`](../../../src/components/scheduling/DeleteTemplateDialog.tsx):

```
<DialogFooter className="sticky bottom-0 bg-background border-t border-border/40 px-6 py-4 gap-2">
```

Without this, adding the ledger to a `max-h-[80vh]` dialog that already holds seven form fields
pushes Save off-screen on a 375×667 viewport — roughly 533px of usable dialog height.

**Delta framing over counts.** The header shows the old range struck through, an arrow, the new
range, and a badge reading `+1h later` or `same length`. A manager reasons about "everyone
starts an hour later", not about "23 rows affected".

The delta badge is **not** a `LedgerChip`. `LedgerTone` is `'destructive' | 'warning' |
'success'` — a severity enum ([`deletionCopy.ts:20`](../../../src/lib/scheduling/deletionCopy.ts)) — and
"+1h later" is neutral fact, not a severity signal. Routing it through the tone system would
force an arbitrary amber that reads as a warning for what is usually a benign change. It gets
the documented neutral badge styling instead: `text-[11px] px-1.5 py-0.5 rounded-md bg-muted`.
Do not add a fourth `LedgerTone` value — the type is imported by the deletion flow, not
duplicated, so widening it changes shipped behaviour for no benefit here.

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

Variants follow [`DeleteTemplateDialog.tsx:245-262`](../../../src/components/scheduling/DeleteTemplateDialog.tsx)
and the CLAUDE.md button classes: `ghost` Cancel, `outline` "Template only",
`bg-foreground text-background hover:bg-foreground/90` for "Save & update N shifts" — so two
similar-weight CTAs don't compete on a crowded mobile footer.

**When N is 0** — a new template, or every linked shift is past/locked/excluded — the split
collapses back to a single primary `Save changes`. "Save & update 0 shifts" is nonsense, and
offering a choice with no difference is worse than offering none. While the impact query is
loading, render the single `Save changes` button disabled rather than a button whose label is
about to change under the pointer.

**No acknowledgement checkbox.** The delete dialog needs one because its cascade is
irreversible. This one isn't — so the guardrail is Undo, not friction.

**Drift disclosure.** The "Your call" bucket renders collapsed behind a disclosure showing the
count. Expanding lists each drifted shift with who's on it, its date, and its current time,
each with an unchecked checkbox.

Build it on the Radix `Collapsible` already vendored at
[`src/components/ui/collapsible.tsx`](../../../src/components/ui/collapsible.tsx), which wires
`aria-expanded` and `aria-controls` itself — hand-rolling those attributes is avoidable
surface. Each row needs a real `<label>` naming the employee and date, not a bare checkbox.

The drift rows do **not** come from `buildHoursChangeLedger`. `LedgerLine` is
`{ key: string; text: string }` ([`deletionCopy.ts:28-31`](../../../src/lib/scheduling/deletionCopy.ts)) —
a flat display record for static panel rows, with nowhere to put a `shiftId` for the selection
state or the structured fields a labelled checkbox needs. Repurposing `key` as the shift id
would be an unstated convention that two implementers would resolve two different ways.

Instead the rows come straight off the `driftedShifts` bucket returned by
`bucketTemplateShifts`, typed explicitly:

```ts
interface DriftRow {
  shiftId: string;
  employeeName: string | null;   // null → "Unassigned"
  localDate: string;             // restaurant-local YYYY-MM-DD
  currentStart: string;          // restaurant-local HH:MM
  currentEnd: string;
}
```

The parent owns `selectedDriftIds: Set<string>` and passes it down; on save that set becomes
`p_drifted_shift_ids`. The copy builder keeps producing `LedgerLine`s for the static
Changes/Untouched panels only, so its existing type stays untouched and shared with deletion.

### Announcing the recompute

A live-recomputing region is invisible to a screen-reader user unless it announces, and
unbearable if it announces on every keystroke. Both failure modes are easy to ship here, so
the behaviour is specified rather than left to the implementer.

`aria-live="polite"` goes on the **collapsed summary line only** — the one sentence carrying
severity, delta, and affected count. Not on the chip row, not on the Changes/Untouched panels,
not on the drift list. A polite region announces its entire subtree on change; scoping it to
the summary means one short sentence per settled edit instead of a re-read of the whole ledger.

Never `assertive`. Assertive interrupts whatever the user is currently hearing — including the
time input they are still typing into. Nothing here is urgent enough to interrupt; the change
has not even been saved yet.

The recompute is debounced **300ms** on the time inputs. `<input type="time">` fires `change`
per component (hour, then minute, then meridiem), so an undebounced ledger announces two or
three incoherent intermediate states per edit. 300ms is long enough to coalesce those and short
enough that the panel still feels live. Debounce the derived ledger state, not the controlled
input value — the field itself must stay instant or it feels broken.

Nothing about this is a network round-trip: `useTemplateLinkedShifts` fetches once per template
and every recompute is pure client-side bucketing, so the debounce is purely about announcement
coherence and render churn.

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

**The guard alone is not sufficient, and this is the easiest way to get this feature wrong.**
`user_has_capability(p_restaurant_id, ...)` proves only that the caller may edit scheduling
*at the restaurant they named*. It says nothing about whether `p_template_id` or the ids in
`p_drifted_shift_ids` belong to that restaurant. Since RLS is bypassed, a manager legitimately
authorized at restaurant A could pass `p_restaurant_id = A` together with a template and shift
ids from restaurant B and retime another tenant's schedule.

Therefore **every statement in both functions must additionally scope by
`restaurant_id = p_restaurant_id`**, non-negotiably:

```sql
UPDATE public.shift_templates SET ... WHERE id = p_template_id AND restaurant_id = p_restaurant_id;
UPDATE public.shifts        SET ... WHERE ... AND restaurant_id = p_restaurant_id;
```

— including the opted-in drift branch (`id = ANY(p_drifted_shift_ids) AND restaurant_id =
p_restaurant_id AND shift_template_id = p_template_id`) and the undo function's revert. This
is the same defensive filtering `publish_schedule`/`unpublish_schedule` already apply. pgTAP
must cover the cross-tenant attempt explicitly, asserting zero rows changed.

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

The index is deliberately **not** `CONCURRENTLY`. `schedule_change_logs` is written on most
scheduling actions, so a long SHARE lock would matter — but the partial predicate matches zero
rows at creation time (the column is brand new and unbackfilled), so the build is effectively
instantaneous regardless of table size. That keeps both statements in one migration file, which
`CREATE INDEX CONCURRENTLY` would forbid. This is a deliberate trade, not an oversight.

### `undo_template_hours_cascade(p_batch_id, p_restaurant_id)`

Reverts each logged shift from its `before_data`, with two skip conditions that must be
distinguished rather than lumped together:

- **Changed since** — the shift's current times no longer match the `after_data` the cascade
  wrote, meaning someone edited it in between. Blindly restoring would destroy a newer,
  deliberate edit.
- **Deleted since** — the shift row is gone.

Detecting "deleted" needs care. `schedule_change_logs.shift_id` is **not** a foreign key:
[`20260617120000_fix_schedule_change_logs_delete_fk.sql:38-44`](../../../supabase/migrations/20260617120000_fix_schedule_change_logs_delete_fk.sql)
dropped the constraint precisely so that a `deleted` audit row keeps the id of a shift that no
longer exists. The column comment spells it out: *"Join to shifts manually and tolerate missing
rows."* So `shift_id IS NULL` never fires, and testing for it would produce a branch that is
dead by construction. Detect deletion with:

```sql
NOT EXISTS (SELECT 1 FROM public.shifts s WHERE s.id = l.shift_id)
```

Returns `{ restored_count, changed_since_count, deleted_count }`, and the toast reports what
actually happened: `Restored 12 shifts · 1 skipped (changed since)`. Same authorization guard
and the same mandatory `restaurant_id = p_restaurant_id` scoping as the cascade.

Surfaced via `ToastAction`, the pattern already used by `hideMutation` at
[`useShiftTemplates.tsx:192-199`](../../../src/hooks/useShiftTemplates.tsx).

### The `log_shift_change` trigger will also fire

`shifts` carries an `AFTER UPDATE` trigger, `log_shift_change()`
([`20251123000000_schedule_publishing.sql:96-162`](../../../supabase/migrations/20251123000000_schedule_publishing.sql)),
which auto-inserts an **untagged** `schedule_change_logs` row (`change_type = 'updated'`,
`before_data`/`after_data` as full `row_to_json`) for any update to a shift where
`OLD.is_published = true`.

So every published shift the cascade touches produces two log rows: the trigger's untagged one
and the RPC's `cascade_batch_id`-tagged one. Same again on undo.

This is tolerable — undo scopes by `cascade_batch_id IS NOT DISTINCT FROM p_batch_id`, so the
untagged rows are invisible to it, and a doubled audit trail is not a correctness problem. But
it must be written down, because a reader counting rows in `schedule_change_logs` after a
cascade will otherwise conclude something has gone wrong. pgTAP asserts both rows exist and
that the batch-scoped count is unaffected by the trigger's.

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
- every `DriftRow` carries a `shiftId` and a `localDate` rendered in the restaurant's timezone,
  since those two fields are what the checkbox label and the RPC argument are built from

**Playwright** — one path: edit a template's hours with linked shifts present, confirm the
ledger appears with correct counts, save with cascade, confirm the grid shows moved shifts.
Accessible selectors only (`getByRole`, `getByLabel`) — which doubles as the a11y assertion:
each drift checkbox must be reachable by `getByLabel` naming the employee and date, and the
primary button must read `Save changes` when nothing cascades and `Save & update N shifts`
when something does.

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
