# Kiosk punch fails RLS on INSERT ... RETURNING — design

## Problem

A kiosk service account cannot record a punch. The kiosk shows this toast:

> Error recording punch — new row violates row-level security policy for table "time_punches"

A customer restaurant reported it on 2026-10-31. Every restaurant that uses a
kiosk service account (`user_restaurants.role = 'kiosk'`) has the same failure.
A kiosk that a manager starts from their own login works, because the manager
holds `view:scheduling`.

## Root cause

1. The kiosk punch goes through `useCreateTimePunch`. That hook calls
   `.insert({...punchData, photo_path, created_by: userId}).select().single()`
   (`src/hooks/useTimePunches.tsx:254-263`). PostgREST sends this as
   `INSERT ... RETURNING *`.
2. `created_by` is the signed-in user id from `getSession()`
   (`src/hooks/useTimePunches.tsx:185-186`, `:259`). For a kiosk service
   account, this is the kiosk user.
3. The INSERT policy admits the kiosk role through a literal branch:
   `user_has_capability(..., 'edit:time_punches') OR ur.role = 'kiosk'`
   (`supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:526-538`).
4. Postgres also checks the SELECT policies against the row that `RETURNING`
   gives back. If no SELECT policy admits the row, Postgres raises
   `new row violates row-level security policy`.
5. Migration `20260805130000_self_scope_employee_reads.sql:164-173` deleted the
   membership-only SELECT policy. Only two SELECT policies stay
   (`:175-193`): own employee row, and `view:scheduling OR view:payroll`.
6. The kiosk role holds neither capability. The legacy role branch of
   `user_has_capability` does not list kiosk for either capability
   (`supabase/migrations/20260806140000_legacy_role_sensitive_flags.sql:129,138`).
   The kiosk role also has no `role_areas` rows, so the area branch gives
   nothing (`supabase/migrations/20260730150000_rewrite_collaborator_policies.sql:517-519`).
   The kiosk user is also not the employee who punches.

Result: the INSERT check passes, the RETURNING check fails, and Postgres
rolls back the insert.

### Reproduction (local database, all migrations applied)

As a `kiosk` member, with `request.jwt.claims.sub` set to the kiosk user:

- `INSERT INTO time_punches (...) VALUES (...)` → `INSERT 0 1`
- the same insert with `RETURNING id` → `ERROR: new row violates row-level
  security policy for table "time_punches"`

## Approaches

**A. New SELECT policy: a user can read a punch that the user created
(recommended).**
`USING (created_by = (select auth.uid()))`, `TO authenticated`.

- Smallest grant that fixes the bug. The kiosk sees only rows that it wrote.
  It does not see other punches of the restaurant.
- The read grant matches the write path: the row exists only because the same
  user was allowed to insert it (lesson 2026-07-13, "SELECT policy must match
  the write-path authorization").
- No client change, so no change to the offline queue or optimistic UI.
- Owners, managers, and employees already read these rows through the
  current policies, so their access does not change.

**B. Client change: delete `.select()` for kiosk punches.**
The hook returns the inserted row to `onSuccess`, the photo flow, and the
punch-status cache. A change there touches the kiosk hot path and its many
mocked tests. A future `.select()` would bring the bug back. Rejected.

**C. Give kiosk a restaurant-wide SELECT policy again.**
This reverts the privacy goal of `20260805130000`. A shared tablet then reads
every punch time and location of the restaurant. Rejected.

## Design (approach A)

New migration `supabase/migrations/20261031120000_time_punches_creator_select.sql`:

```sql
DROP POLICY IF EXISTS "Creators can view punches they created" ON public.time_punches;
CREATE POLICY "Creators can view punches they created"
  ON public.time_punches
  FOR SELECT
  TO authenticated
  USING (created_by = (select auth.uid()));
```

- `(select auth.uid())` keeps the call as an init plan, one call per query.
- `created_by` is nullable. `NULL = uid` is not true, so rows without a
  creator stay hidden.
- The restrictive `"Deny anonymous access to time_punches"` policy
  (`supabase/migrations/20260110000000_fix_rls_anonymous_access.sql:68-73`)
  still blocks `anon`.

### Risk check

- A user can set `created_by` on insert only on a row that an INSERT policy
  already admits. So the policy grants read only on rows the user could
  already write.
- UPDATE policies admit only managers
  (`supabase/migrations/20251115165031_3275bc7c-bc33-4b20-b42c-fd1a9c022d07.sql:77`)
  and the employee who owns the row
  (`supabase/migrations/20251114100100_create_time_tracking_tables.sql:98`).
  Both already read the row, so a change of `created_by` gives no new reach.
- No index is needed for the kiosk path. The RETURNING check evaluates one row.
  Manager list reads still pass the capability policy; Postgres ORs the extra
  cheap equality check.

## Tests

- pgTAP `supabase/tests/time_punches_kiosk_insert_returning.sql`:
  - kiosk member: `INSERT ... RETURNING` lives (the regression).
  - kiosk member sees its own created punch.
  - kiosk member does not see a punch that another user created in the same
    restaurant.
  - staff member does not see a coworker punch (self-scope stays).
  - kiosk member of restaurant R1 cannot insert into restaurant R2.
- E2E: see Plan. The local `npm install` fails in this session (proxy blocks
  `cdn.sheetjs.com`), so the Playwright run is not possible here.

## Privacy

No real restaurant, employee, or user names appear in this document, the
tests, or the commit messages.
