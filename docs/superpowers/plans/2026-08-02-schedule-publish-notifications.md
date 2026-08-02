# Plan — Schedule Publish Notifications + Employee Schedule Clarity

- **Branch:** `fix/schedule-publish-notifications`
- **Spec:** `docs/superpowers/specs/2026-08-02-employee-schedule-clarity-design.md` (a49debfd)
- **Scope:** the five approved items (a–e) plus the §F bucketing fix. Nothing else.

## Decision needed before Phase 4

**Do not add an UPDATE RLS policy to `schedule_publications`.** The approved scope said
"use `serviceClient` **and** add the missing UPDATE RLS policy," but those are alternatives:
`serviceClient` bypasses RLS entirely, so the policy is unnecessary for the fix, and a policy
broad enough to satisfy the old code path would let any manager-role client forge
`notification_sent` — and, once §D lands, the retraction audience too. The plan below ships the
`serviceClient` fix plus a pgTAP test asserting the table stays un-UPDATE-able. Say the word if
you want the policy anyway; the harmless documenting form is `USING (false) WITH CHECK (false)`.

## Order of work

Server first (steps 1–5), because the UI's 4-state model reads state the migration creates.
Each step is a commit; tests land with the code they cover, not after.

### 1. `_shared/emailQueue.ts` + `sendEmailResult` — defect C

- Add `sendEmailResult()` to `_shared/notificationHelpers.ts` returning
  `{ ok, status, error? }`; reimplement the existing `sendEmail` as
  `(await sendEmailResult(...)).ok`. Its 6 external call sites are untouched and provably
  unchanged.
- New `_shared/emailQueue.ts`: paced sender (≤2/s), 429 → retry with backoff, everything else →
  terminal. Returns per-recipient results so defect B can report them. Logs recipient count and
  total elapsed so the wall-clock ceiling is observable before it's hit.
- `tests/unit/emailQueue.test.ts` — pacing interval respected; 429 retried then succeeds; hard
  failure not retried; result shape preserved.

### 2. Migration — `schedule_retractions` + `unpublish_schedule` — defect D

One migration, `CREATE OR REPLACE` on `unpublish_schedule` with its `RETURNS INTEGER` signature
and `SECURITY DEFINER` / `SET search_path = public, pg_temp` re-stated (omitting either resets it).

- Table + partial index per spec §D.
- Replace `GET DIAGNOSTICS` with the CTE aggregate — this is a behavior fix, not a refactor: left
  as-is it would return the INSERT's row count and the manager toast would read "1 shift."
- `COALESCE(array_agg(...) FILTER (WHERE employee_id IS NOT NULL), '{}')` for the audience.
- Guard the retraction INSERT on `v_shift_count > 0`.
- RLS: SELECT for restaurant members; no INSERT/UPDATE/DELETE policy (writes are RPC/service-role
  only), mirroring `schedule_publications`.
- `supabase/tests/schedule_retractions.sql` (pgTAP): audience captured pre-flip and matches the
  employees who had published shifts; double-unpublish inserts nothing and does not raise;
  `authenticated` cannot UPDATE `schedule_publications` (zero affected rows, not `throws_ok`);
  same for `schedule_retractions`.

### 3. `notify-schedule-published` — defects A, B, C

- `notification_sent` write moves to `serviceClient`, with `.select('id')`, and the error and row
  count are checked and logged.
- Fan-out goes through the step-1 queue.
- Return a non-2xx when `failureCount > 0`, with the structured body preserved.
- No refactor onto the shared helpers — noted as follow-up so the diff stays reviewable.

### 4. `notify-schedule-unpublished` (new) — defect D

Built on `_shared/notificationHelpers.ts` (not cloned from the publish function). Takes
`{restaurantId, weekStart}` only:

1. Latest unnotified retraction for the week, `ORDER BY retracted_at DESC LIMIT 1`.
2. Null-safe `LEFT JOIN` to the publication; abort unless `notification_sent = true`.
3. Atomic claim: `UPDATE ... SET notified_at = now() WHERE id = $1 AND notified_at IS NULL
   RETURNING *`; zero rows → exit quietly. Reset to NULL if the send fails outright.
4. Email + web push + native push to `employee_ids`, through the queue, §7(a) copy.
- `_shared/schedulePublishedPush.ts` gains a sibling retraction-push helper.

### 5. `useSchedulePublish.tsx` — defects B, F

- `usePublishSchedule`: await the invoke, read `error.context.json()`, and surface three distinct
  toasts (full success / partial / total failure). Publishing itself must still read as
  successful — the RPC has already committed.
- `useUnpublishSchedule`: same, invoking `notify-schedule-unpublished`.
- Fix `:169-175` to bucket by the restaurant timezone instead of browser-local `toISOString()`.
- `tests/unit/useSchedulePublish.test.ts` — the three toast branches; week bucketing at a week
  edge in a non-UTC restaurant timezone.

### 6. `useWeekScheduleStatus` (new hook) — item (e)

Returns `{ state, publication, publishedCount, draftCount, loading }` for the 4-state model.
Separate from `useWeekPublicationStatus`, which stays as-is for manager surfaces.
`tests/unit/useWeekScheduleStatus.test.ts` covers all four states plus the incident scenario
(publication row exists, `notification_sent: true`, `publishedCount: 0` → `retracted`).

### 7. Employee UI — item (e)

- `ShiftRow.tsx` (new, shared) — one row for both the day grid and the Upcoming Shifts card,
  branching internally on `isPublished`.
- `ScheduleStatusBanner.tsx` (new) — the four states plus state B's one-line chip, in a
  fixed-height slot; `role="status"` in A/B/C, default `role="alert"` in D.
- `scheduleSeenFingerprint.ts` (new) — fingerprint + localStorage, interaction-dismiss only, 8-week
  pruning on write.
- `EmployeeSchedule.tsx` — wire all of it; neutralize the Upcoming card's green chrome when every
  row in it is a draft; add the missing `useShifts().error` branch.
- Unit tests for the fingerprint, the banner, and `ShiftRow`.

### 8. E2E

`tests/e2e/employee-schedule-retraction.spec.ts` — publish as manager → employee sees the clean
published state → unpublish → employee sees the retracted banner and every row in the tentative
treatment (rows present, per Decision 1).

## Then Phases 5–9

code-simplify → the four parallel reviewers + CodeRabbit → `npm run typecheck && lint && test` →
PR → CI loop until green.

## Known limitation to state in the PR

Every production publication row currently reads `notification_sent = false` — that *is* defect A
— so the Decision 2 gate suppresses all retraction notifications until a week is published after
this ships. Correct-conservative and self-healing within one publish cycle. No backfill: it would
assert deliveries we can't verify, and it's a prod write needing separate approval.
