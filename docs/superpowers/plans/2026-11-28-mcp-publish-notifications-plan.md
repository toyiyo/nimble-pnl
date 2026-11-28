# Plan: MCP publish and notification tools

Design: `docs/superpowers/specs/2026-11-28-mcp-publish-notifications-design.md`
TLA+: `specs/tla/publish-notifications/` (`tlc.sh all`: 15/15 match)
Branch: `claude/quirky-maxwell-t8vm5r`
Text standard: STE-aligned (`docs/STE100_STYLE.md`)

Each task is one TDD cycle: write the failing test, write the code, run the
test, commit with explicit paths. Do the tasks in order.

## Task 1: Migration A — tables, grants, RLS

- File: `supabase/migrations/20261128120000_schedule_notifications.sql`.
- Create `schedule_notifications` and `schedule_notification_changes` with the
  columns, FK delete rules, `UNIQUE (change_log_id, employee_id)`, and the
  `status` CHECK from design section 1.
- Indexes: `(restaurant_id, created_at)` on `schedule_notifications`; partial
  `(restaurant_id, claimed_at) WHERE status IN ('claimed','failed')`;
  `notification_id` on `schedule_notification_changes`.
- `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, then
  `GRANT SELECT TO authenticated`.
- SELECT policy: `user_has_capability(restaurant_id, 'view:scheduling')`.
- Test first: `supabase/tests/schedule_notifications_tables.test.sql`. Cover
  table and column existence, the unique index, RLS isolation between two
  restaurants, and no INSERT for `authenticated`.

## Task 2: Migration B — change-log columns and date trigger

- File: `supabase/migrations/20261128120100_schedule_change_logs_tracking.sql`.
- Add `shift_date_before date`, `shift_date_after date`,
  `tracked boolean not null default true`.
- `UPDATE schedule_change_logs SET tracked = false` for every existing row.
- `ALTER COLUMN changed_by DROP NOT NULL`.
- New function `schedule_change_log_fill_dates()` and a `BEFORE INSERT`
  trigger. Time zone rule: the `publish_schedule` rule (`UTC` fallback).
- Indexes `(restaurant_id, shift_date_after)` and
  `(restaurant_id, shift_date_before)`.
- Test first: `supabase/tests/schedule_change_logs_tracking.test.sql`. Cover
  the dates in `America/Chicago` at 22:00 local, an invalid zone, a direct
  INSERT (the cascade path), `tracked` default, and a null `changed_by`.

## Task 3: Migration C — re-declare `log_shift_change`

- File: `supabase/migrations/20261128120200_log_shift_change_published.sql`.
- Carry the body of `20251123000000_schedule_publishing.sql:96-163` forward.
  Add `SET search_path = public, pg_temp`.
- Add the `published` branch (INSERT with `NEW.is_published`, and the flip).
- `updated` branch: log only when `start_time`, `end_time`, `employee_id`,
  `position`, `break_duration`, `notes`, or a move to or from
  `status = 'cancelled'` is distinct.
- Recreate the trigger as `AFTER INSERT OR UPDATE OR DELETE`.
- Test first: `supabase/tests/log_shift_change_published.test.sql`. Cover the
  flip by `publish_schedule`, an INSERT with `is_published = true`, a draft
  INSERT (no row), a no-op update (no row), a time change (one row), delete,
  and unpublish.

## Task 4: Migration D — read functions

- File: `supabase/migrations/20261128120300_schedule_notification_reads.sql`.
- `get_schedule_pending_notifications(p_restaurant_id, p_from, p_to)` and
  `get_schedule_week_change_log(p_restaurant_id, p_from, p_to)`.
- SECURITY DEFINER, `SET search_path`, explicit
  `user_has_capability(..., 'view:scheduling')` check first.
- Pending rule: tracked, `change_type IN ('published','updated','deleted')`,
  recipient not null, no `sent` link. States: `pending`, `failed`,
  `in_doubt`.
- The before recipient uses `shift_date_before`. The after recipient uses
  `shift_date_after`.
- `REVOKE EXECUTE ... FROM PUBLIC, anon`; `GRANT EXECUTE TO authenticated`.
- Test first: `supabase/tests/schedule_notification_reads.test.sql`. Cover a
  staff caller (refused), cross-tenant (refused), a reassignment across a
  week boundary (one pair in each week), `unpublished` rows (never pending),
  `tracked = false` rows (never pending), and each state.

## Task 5: Migration E — claim and mark

- File: `supabase/migrations/20261128120400_schedule_notification_claim.sql`.
- `claim_schedule_notifications(p_restaurant_id, p_from, p_to, p_source,
  p_publication_id, p_change_log_id)`. The advisory lock key is in the design.
  1. Take back `failed` rows of the range, and `claimed` rows between 10 and
     60 minutes old. Keep their change sets.
  2. For each employee with free pairs, insert one new row and its links
     (`ON CONFLICT DO NOTHING`). Delete a new row that got zero links.
  3. Return `notification_id, employee_id, change_log_ids[]`.
- `mark_schedule_notification(p_id, p_status, p_channels, p_error)`.
- Both: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`;
  `GRANT EXECUTE TO service_role`.
- Test first: `supabase/tests/schedule_notification_claim.test.sql`. Cover a
  first claim, a second claim with no change (zero rows), a new change after a
  sent row (new row with only the new change), a failed row (same id back),
  the reclaim windows (backdate `claimed_at`), and grants.

## Task 6: `sendEmailResult` idempotency key

- File: `supabase/functions/_shared/emailQueue.ts`. Add an optional
  `idempotencyKey` that sets the `Idempotency-Key` HTTP header.
- Test first: extend `tests/unit/emailQueue.test.ts`.

## Task 7: Pure helpers for the notifiers

- File: `supabase/functions/_shared/scheduleNotificationClaims.ts`.
- `callClaim`, `callMark` wrappers for the service client, and
  `buildPublishChangeLines(rows)`, which groups lines by shift id.
- Test first: `tests/unit/scheduleNotificationClaims.test.ts`.

## Task 8: `notify-schedule-published` uses the claim

- File: `supabase/functions/notify-schedule-published/index.ts`.
- Replace the all-employees fan-out with the claimed rows (design section 2).
- Zero claimed rows: 200 `{ sent: 0, nothingToSend: true }`.
- Email lists the employee's changes. Push `tag: <row id>`.
- Move the logic that Vitest can cover into Task 7 helpers. Keep the entry
  thin (lesson 2026-05-07).

## Task 9: `notify-shift-changed` uses the claim

- File: `supabase/functions/notify-shift-changed/index.ts`.
- The claim is the only latch. Write `notified_at` after a send that reached
  one recipient or more. Zero claimed rows: 200 `alreadyNotified: true`.
- Test first: the claim and delivery tests in
  `tests/unit/scheduleNotificationDelivery.test.ts`.

## Task 10: UI follow-ons

- `src/hooks/useSchedulePublish.tsx`: map `nothingToSend` to the `skipped`
  outcome with "No notifications were sent." Unit test in
  `tests/unit/useSchedulePublish*.test.ts`.
- `src/types/scheduling.ts`: add `'published'` to `ChangeType`; make
  `changed_by` `string | null`.
- `src/integrations/supabase/types.ts`: new tables, new columns, nullable
  `changed_by`, new functions.
- `src/components/ChangeLogDialog.tsx`: a "Published" label.

## Task 11: MCP tools file

- File: `supabase/functions/_shared/mcpPublishTools.ts`.
- `runPublishWeek`, `runGetWeekChangeLog`, `runGetPendingNotifications`.
  Dependencies (supabase client, invoke function, clock, timeout) come in as
  arguments, so Vitest covers them.
- Local times through the restaurant zone; every result has `tz`.
- Test first: `tests/unit/mcpPublishTools.test.ts`. Cover preview grouping,
  the confirm order (RPC, then function), `notify: false`, the 15 s wait,
  preview drift, invalid `week_start`, and RPC errors.

## Task 12: Register the tools

- `supabase/functions/_shared/tools-registry.ts`: three definitions, the
  manager/owner list, `publish_week` in `WRITE_TOOLS`.
- `supabase/functions/_shared/aiWriteTools.ts`: add `publish_week`.
- `supabase/functions/ai-execute-tool/index.ts`: three `case` lines.
- Test first: extend `tests/unit/tools-registry.test.ts` and
  `tests/unit/mcpHandler.test.ts` (catalog, destructive hint, role gate).

## Task 13: E2E

- Extend `tests/e2e/schedule-quiet-publish-live-edit.spec.ts`, or the publish
  spec it uses. A republish with no change shows "No notifications were
  sent." A republish after an edit notifies.

## Task 14: Docs and TLA+

- `docs/CLAUDE_INTEGRATION.md`: list the three tools.
- Run `.claude/skills/run-tla/tlc.sh all`. Expect every config to match.

## Verify (Phase 8)

`npm run test`, `npm run test:db`, `npm run test:e2e`, `npm run typecheck`,
`npm run lint`, `npm run build`, `tlc.sh all`.

## Risks

- Other sessions change `tools-registry.ts` and `ai-execute-tool/index.ts`.
  Keep those edits to registration lines only.
- The migration timestamps can collide with other branches. Rename at merge
  time if needed.
