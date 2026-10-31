# Kiosk punch fails RLS on INSERT ... RETURNING — design

## Problem

A kiosk service account cannot record a punch. The kiosk shows this toast:

> Error recording punch — new row violates row-level security policy for table "time_punches"

A customer restaurant reported it on 2026-10-31.

Scope, from code (not from production data):

- A kiosk service account has `user_restaurants.role = 'kiosk'` and no
  `employees` row. The edge function creates only an auth user and a
  membership row (`supabase/functions/create-kiosk-service-account/index.ts:106-136`).
  The root cause below applies to every such account.
- A kiosk that a manager opens from their own login runs as the manager.
  `useCreateTimePunch` uses the session user (`src/hooks/useTimePunches.tsx:185-186`).
  The manager holds `view:scheduling`, so the SELECT check passes.

## Root cause

1. The kiosk punch goes through `useCreateTimePunch`. That hook calls
   `.insert({...punchData, photo_path, created_by: userId}).select().single()`
   (`src/hooks/useTimePunches.tsx:254-263`). PostgREST sends this as
   `INSERT ... RETURNING *`.
2. `created_by` is the signed-in user id (`src/hooks/useTimePunches.tsx:259`).
3. The INSERT policy admits the kiosk role through a literal branch:
   `user_has_capability(..., 'edit:time_punches') OR ur.role = 'kiosk'`
   (`supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:526-538`).
4. For `INSERT ... RETURNING`, Postgres also applies the SELECT policies to the
   new row. If no SELECT policy admits it, Postgres raises
   `new row violates row-level security policy`. Reference: PostgreSQL
   documentation, `CREATE POLICY`, table "Policies Applied by Command Type"
   (INSERT with RETURNING needs SELECT on the new row).
5. Migration `20260805130000_self_scope_employee_reads.sql:164-173` deleted the
   membership-only SELECT policy. Two SELECT policies stay (`:175-193`): own
   employee row, and `view:scheduling OR view:payroll`.
6. The Kiosk built-in role (`b0000000-...-0006`) has no capabilities and no
   `role_areas` rows
   (`supabase/migrations/20260730110000_seed_builtin_roles.sql:73,79-80`).
   Memberships with no `role_id` use the legacy branch, and that branch does
   not list kiosk for either capability
   (`supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:129,138`).
   The kiosk user has no `employees` row (step "Scope" above).

Result: the INSERT check passes, the RETURNING check fails, and Postgres
cancels the insert.

### Reproduction (local database, all repo migrations applied)

As a `kiosk` member, with `request.jwt.claims.sub` set to the kiosk user:

- `INSERT INTO time_punches (...) VALUES (...)` → `INSERT 0 1`
- the same insert with `RETURNING id` → `ERROR: new row violates row-level
  security policy for table "time_punches"`

### Production state — not checked

The production database tools did not connect in this session. The local
database proves the mechanism, but not the production policy set.
`20260805130000` says its policy bodies came from production `pg_policies`
(`:28`), so production can carry policies that a local reset does not
create. Before the production apply, run this read-only query and compare:

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies where tablename = 'time_punches';
```

Open question: `20260805130000` is dated 2026-08-05, and the report is dated
2026-10-31. The date that the migration reached production, and the date that
this restaurant started to use a kiosk service account, are not known here.

## Approaches

**A. Bounded SELECT policy for the creator (recommended).**
A member can read a punch that the member created in the last 5 minutes.

- It fixes the `RETURNING` check, which runs in the same statement.
- The 5-minute window prevents access to the punch history of the restaurant
  from a shared kiosk tablet. That history has `location`, `device_info`, and
  `photo_path`.
- The membership check prevents access by a removed member to rows that they
  created before the removal.
- No client change, so no change to the offline queue or the optimistic UI.

**B. Client change: delete `.select()` for kiosk punches.**
The hook returns the inserted row to `onSuccess`, the photo flow, and the
punch-status cache. A change there touches the kiosk hot path and many mocked
tests. A future `.select()` brings the bug back. Rejected.

**C. Give kiosk a restaurant-wide SELECT policy again.**
This reverts the privacy goal of `20260805130000`. Rejected.

**D. Unbounded creator policy (`created_by = auth.uid()` only).**
The first draft. The design review rejected it. The kiosk writes almost every
punch, so it can read the full history. A removed or demoted manager keeps read
access to bulk rows that they created (`src/hooks/useTimePunches.tsx:415-423`).
Rejected.

## Design (approach A)

New migration `supabase/migrations/20261031120000_time_punches_creator_select.sql`:

```sql
SET LOCAL lock_timeout = '3s';

DROP POLICY IF EXISTS "Creators can view punches they just created" ON public.time_punches;
CREATE POLICY "Creators can view punches they just created"
  ON public.time_punches
  FOR SELECT
  TO authenticated
  USING (
    created_by = (select auth.uid())
    AND created_at >= now() - interval '5 minutes'
    AND EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = (select auth.uid())
        AND ur.restaurant_id = time_punches.restaurant_id
    )
  );
```

- `created_at` defaults to `NOW()`
  (`supabase/migrations/20251114100100_create_time_tracking_tables.sql:16`).
  `now()` is the transaction start, so the `RETURNING` check always passes.
- The offline queue payload has no `created_at` (`src/utils/offlineQueue.ts:132`),
  so a late flush gets the flush time and passes too.
- The flush calls the same `mutateAsync` (`src/pages/KioskMode.tsx:141-157`),
  so the fix covers it.
- `created_by` is nullable. Sling rows have a null `created_by`
  (`supabase/migrations/20260223100100_sling_sync_rpc.sql:79-97`) and stay
  hidden.
- `(select auth.uid())` runs once per query as an init plan.
- `lock_timeout` limits the wait for the `ACCESS EXCLUSIVE` lock at shift
  change. On a timeout, run the migration again.
- Rollback: `DROP POLICY "Creators can view punches they just created" ON public.time_punches;`

### All INSERT policies on `time_punches` (repo migrations)

- `"Managers can create time punches for employees"` — capability or kiosk
  literal (`20260730150000_rewrite_collaborator_policies.sql:526-538`)
- `"Managers can insert for employees"` — owner/manager literal
  (`20251115165031_3275bc7c-bc33-4b20-b42c-fd1a9c022d07.sql:64-74`)
- `"Employees can insert own time punches"` (`20251115165031_...sql:54-61`)
- `"Employees can create own time punches"`
  (`20251114100100_create_time_tracking_tables.sql:77-83`)

None of these limits `created_by`. See "Decided trade-offs".

### Performance

For manager list reads, Postgres ORs the new policy into the filter. The
`created_by` compare fails first for most rows, so the `EXISTS` subquery does
not run for them. The `(restaurant_id, punch_time)` index still drives the
scan (`20260524120000_idx_time_punches_restaurant_punch_time.sql:12`).

## Tips after a clock-out (added after code review)

The kiosk opens the tip dialog after each clock-out
(`src/pages/KioskMode.tsx:456-461`). `useEmployeeTips` sends
`.insert(...).select().single()` on `employee_tips`
(`src/hooks/useEmployeeTips.tsx:78-91`). For a kiosk account this fails in two
places:

- No INSERT policy on `employee_tips` admits the role `kiosk`. The policies
  need an `employees` row or the role `owner`/`manager`.
- No SELECT policy admits the returned row.

Migration `supabase/migrations/20261031120100_employee_tips_kiosk_insert.sql`
adds two policies:

- `"Kiosk can create employee tips"` (INSERT). The caller must be a `kiosk`
  member of the restaurant. The employee must belong to the same restaurant.
  `created_by` must be the caller. The kiosk can already insert punches for
  these employees, so the trust level is the same.
- `"Creators can view tips they just created"` (SELECT). The same bounded
  creator policy as `time_punches`.

## Kiosk rotation (added after code review)

`time_punches.created_by` references `auth.users` with no `ON DELETE` clause
(`supabase/migrations/20251114100100_create_time_tracking_tables.sql:18`).
After this fix, a kiosk that records a punch cannot be deleted. `deleteUser`
returns "Database error deleting user". The old rotation ignored that error
(`supabase/functions/create-kiosk-service-account/index.ts:99`, before this
branch). The old login then kept its `kiosk` membership and could still
insert punches, with no row in `kiosk_service_accounts` to show it.

The new module `supabase/functions/_shared/kioskAccountRetire.ts` retires
the old account:

1. Delete the old `user_restaurants` row. This removes all access through RLS.
2. Delete the auth user.
3. If step 2 fails, ban the auth user, so the old password cannot sign in.
4. If a step fails, throw. The edge function then returns 500 and creates
   no new credential.

Local check against real Auth and Postgres: the plain `deleteUser` fails;
`retireKioskAccount` returns `banned`; the old membership count is 0; the old
password gets "User is banned"; the old access token gets
`new row violates row-level security policy for table "time_punches"` on
insert.

## Decided trade-offs

- **`created_by` and `created_at` are client-written.** No INSERT or UPDATE
  policy limits them on `time_punches`.
  - A spoofed `created_by` gives the named user read access to that row for
    5 minutes. This occurs only if that user is a member of the same
    restaurant.
  - A future `created_at` keeps a row inside the window. Only the writer of
    that row gets the access, and the writer already holds that data.
  - The legacy `"Managers can update time punches"` policy checks only the
    role literal. A member with that role can set both columns on rows that
    they cannot read, and then read them for 5 minutes.
  - Follow-up: a trigger that sets `created_by := auth.uid()` and
    `created_at := now()` on INSERT, and keeps both columns unchanged on
    UPDATE. It touches every write path of a hot table, so it gets its own
    change.
- **Foreign key on `created_by`.** The follow-up changes it to
  `ON DELETE SET NULL` and adds
  `CREATE INDEX CONCURRENTLY idx_time_punches_created_by ON public.time_punches (created_by) WHERE created_by IS NOT NULL;`.
  Today each `deleteUser` checks the FK with a full scan of `time_punches`.
- **`get_employee_punch_status` has no pinned `search_path`.** Out of scope.
  Follow-up issue.
- **Offline queue `punch_time`.** `queuePunchOffline` sets `punch_time` when
  it queues the punch, not when the employee pressed the button
  (`src/pages/KioskMode.tsx:608`). Follow-up issue.
- **Duplicate punch on a retry.** The insert can succeed on the server while
  the client aborts at `PUNCH_INSERT_TIMEOUT_MS`. If the kiosk is offline at
  that moment, it queues the punch and sends it again. Follow-up: a client
  idempotency key.

## Data recovery

Two groups of punches failed before the fix:

- **Online punches.** On a mutate error, the kiosk queues a punch only when
  `isLikelyOffline()` is true (`src/pages/KioskMode.tsx:296`). An RLS error is
  not an offline error, so these punches are lost.
- **Offline punches.** A punch queued while the kiosk was offline failed on
  flush. `flushQueuedPunches` keeps a failed entry and every entry after it in
  `localStorage` (`src/utils/offlineQueue.ts:147-153`). After the migration,
  the next punch or the next kiosk page load sends them again, with their
  original `punch_time` (`src/pages/KioskMode.tsx:154-157`).

Warning: if a manager enters a punch by hand before the queue flushes, the
database gets a duplicate punch. Duplicates change hours and payroll.

Steps:

1. Apply the migrations.
2. Open the kiosk page on each kiosk device. Record one punch, so the queue
   flushes.
3. Run this read-only query to find the kiosk restaurants and their last
   kiosk-written punch:

   ```sql
   select ur.restaurant_id, max(tp.created_at) as last_kiosk_punch
   from user_restaurants ur
   left join time_punches tp
     on tp.restaurant_id = ur.restaurant_id and tp.created_by = ur.user_id
   where ur.role = 'kiosk'
   group by ur.restaurant_id;
   ```

4. Enter the missing punches by hand on the Time Punches page.
5. Run this read-only query to find duplicates:

   ```sql
   select restaurant_id, employee_id, punch_type, punch_time, count(*)
   from time_punches
   group by 1, 2, 3, 4
   having count(*) > 1;
   ```

## Tests

pgTAP `supabase/tests/time_punches_kiosk_insert_returning.sql` (12 cases):

- kiosk member: `INSERT ... RETURNING` lives (the regression).
- kiosk member sees the punch it created now.
- kiosk member sees a punch it created 4 minutes ago.
- kiosk member does not see punches it created 6 minutes ago and 1 day ago.
- kiosk member does not see its own punch in a restaurant where it is not a
  member.
- kiosk member does not see a punch that another user created.
- removed member (no `user_restaurants` row) sees 0 rows that it created.
- staff member does not see a coworker punch (self-scope stays).
- staff member sees their own punch that the kiosk recorded.
- kiosk member of restaurant R1 cannot insert into restaurant R2.
- manager bulk `INSERT ... RETURNING` of 2 rows returns 2 rows.

pgTAP `supabase/tests/employee_tips_kiosk_insert.sql` (7 cases): the kiosk tip
insert with `RETURNING`, the window, another-restaurant employee, a
non-member restaurant, a spoofed `created_by`, and a staff insert for another
employee.

Unit `tests/unit/kioskAccountRetire.test.ts`: the delete path, the ban path,
the double failure, and a failed membership delete.

E2E `tests/e2e/kiosk-service-account-punch.spec.ts`: a kiosk service account
clocks in, clocks out, and submits a tip. The spec checks the stored punch
and tip rows. It fails without each migration.

## Privacy

No real restaurant, employee, or user names appear in this document, the
tests, or the commit messages.
