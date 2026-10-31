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
- The 5-minute window stops a shared kiosk tablet from reading the punch
  history of the restaurant. That history has `location`, `device_info`, and
  `photo_path`.
- The membership check stops a removed member from reading rows that they
  created before removal.
- No client change, so no change to the offline queue or the optimistic UI.

**B. Client change: delete `.select()` for kiosk punches.**
The hook returns the inserted row to `onSuccess`, the photo flow, and the
punch-status cache. A change there touches the kiosk hot path and many mocked
tests. A future `.select()` brings the bug back. Rejected.

**C. Give kiosk a restaurant-wide SELECT policy again.**
This reverts the privacy goal of `20260805130000`. Rejected.

**D. Unbounded creator policy (`created_by = auth.uid()` only).**
The first draft. The design review rejected it: the kiosk writes almost every
punch, so it reads the full history; a removed or demoted manager keeps read
access to bulk rows they created (`src/hooks/useTimePunches.tsx:415-423`).
Rejected.

## Design (approach A)

New migration `supabase/migrations/20261031120000_time_punches_creator_select.sql`:

```sql
SET lock_timeout = '3s';

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
- `lock_timeout` stops the `ACCESS EXCLUSIVE` lock from a long wait at shift
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

## Decided trade-offs

- **`created_by` is client-written (review M2).** No INSERT or UPDATE policy
  limits it. With this policy, a spoofed `created_by` gives the named user read
  access to that row for 5 minutes, and only if that user is a member of the
  same restaurant. The exposure is small and short. A trigger that forces
  `created_by := auth.uid()` is a follow-up issue, because it touches every
  write path of a hot table.
- **Kiosk rotation (review M4).** `created_by` references `auth.users` with no
  `ON DELETE` clause (`20251114100100_create_time_tracking_tables.sql:18`).
  Rotation calls `deleteUser` and does not check the result
  (`supabase/functions/create-kiosk-service-account/index.ts:99`). With kiosk
  punches that carry a `created_by`, that delete can fail on the foreign key,
  and the old kiosk login stays alive. The 5-minute window limits what the
  old login can read through this policy. The FK change and the error check
  are a follow-up issue.
- **`get_employee_punch_status` has no pinned `search_path` (review m6).**
  Out of scope. Follow-up issue.

## Data recovery

On a mutate error, the kiosk queues a punch only when `isLikelyOffline()` is
true (`src/pages/KioskMode.tsx:296`). An RLS error is not an offline error, so
the kiosk did not keep the failed punches. They are lost. Managers must enter
the missing punches by hand on the Time Punches page. This read-only query
shows the kiosk restaurants and their last kiosk-written punch:

```sql
select ur.restaurant_id, max(tp.created_at) as last_kiosk_punch
from user_restaurants ur
left join time_punches tp
  on tp.restaurant_id = ur.restaurant_id and tp.created_by = ur.user_id
where ur.role = 'kiosk'
group by ur.restaurant_id;
```

## Tests

pgTAP `supabase/tests/time_punches_kiosk_insert_returning.sql`:

- kiosk member: `INSERT ... RETURNING` lives (the regression).
- kiosk member sees the punch it created now.
- kiosk member does not see a punch it created 1 day ago.
- kiosk member does not see a punch that another user created.
- removed member (no `user_restaurants` row) sees 0 rows that it created.
- staff member does not see a coworker punch (self-scope stays).
- kiosk member of restaurant R1 cannot insert into restaurant R2.
- manager bulk `INSERT ... RETURNING` of 2 rows returns 2 rows.

E2E: see the plan.

## Privacy

No real restaurant, employee, or user names appear in this document, the
tests, or the commit messages.
