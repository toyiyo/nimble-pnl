# Block self-grant of restaurant membership — design

**Date:** 2026-08-08
**Task:** Track A Task 1 of
`docs/plans/2026-08-07-account-creation-security-plan.md`
**Audit finding:** Vuln 1 (CRITICAL) in
`docs/SECURITY_AUDIT_ACCOUNT_CREATION_2026-08.md`
**Branch:** `fix/user-restaurants-insert-guard`

---

## Problem

Any user who registers can INSERT a `user_restaurants` row for **any**
restaurant, with **any** role, including `owner`.

### The effective INSERT check today

Four policies exist on `public.user_restaurants`. Two of them apply to INSERT.
Both are PERMISSIVE, so Postgres ORs them. No RESTRICTIVE policy covers INSERT.

Read live from production `pg_policies` on 2026-08-08:

| Policy | Permissive | Cmd | `with_check` |
|---|---|---|---|
| `Owners can manage restaurant associations` | PERMISSIVE | ALL | `((user_id = auth.uid()) OR is_restaurant_owner(restaurant_id, auth.uid()))` |
| `Users can insert their own restaurant associations` | PERMISSIVE | INSERT | `(user_id = auth.uid())` |
| `Prevent self-escalation to privileged roles` | RESTRICTIVE | **UPDATE** | `(is_restaurant_owner(restaurant_id, auth.uid()) OR ((role = ANY (ARRAY['staff','kiosk'])) AND ((role_id IS NULL) OR (role_id = builtin_role_id_for(role)))))` |
| `Users can view their restaurant associations` | PERMISSIVE | SELECT | — |

The OR reduces to:

```
user_id = auth.uid() OR is_restaurant_owner(restaurant_id, auth.uid())
```

Neither disjunct constrains `role`. Neither constrains which `restaurant_id` a
stranger may name. The first disjunct is the hole.

The RESTRICTIVE guard has `cmd = 'UPDATE'`. A command-scoped policy never
applies to another command, so it does nothing here.

### Exploit

```sql
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES (auth.uid(), '<any restaurant_id>', 'owner');
```

`is_restaurant_owner()` then returns true for the attacker. **113 policy
definitions** in the migration history call that function. The attacker reads
and writes the victim's P&L, payroll, bank connections, and inventory. The
`FOR ALL` policy then lets them DELETE the real owner's membership row.

### This gap is known and was deferred

`supabase/migrations/20260730180000_close_role_id_self_escalation.sql:37-40`
records it: the permissive INSERT policy "already lets a user insert their own
membership row with role = 'owner' ... Not addressed here". It is still open.

---

## Which flows actually INSERT a membership row

This decides whether a hard guard is safe. Four writers insert a row. **Every
one of them bypasses RLS.**

| Writer | Mechanism | Bypasses RLS? | Citation |
|---|---|---|---|
| `create_restaurant_with_owner` | `SECURITY DEFINER`, owner `postgres` | **Yes** | `supabase/migrations/20260129000000_add_subscription_system.sql:367-420` |
| `accept-invitation` | service-role client | **Yes** | `supabase/functions/accept-invitation/index.ts:118-133` |
| `scim-v2` | service-role client | **Yes** | `supabase/functions/scim-v2/index.ts:473-475` |
| `create-kiosk-service-account` | service-role client, `.upsert()` | **Yes** | `supabase/functions/create-kiosk-service-account/index.ts:38, 129-136` |

`assign_membership_role` is **not** a writer of new rows. It only UPDATEs an
existing row (`supabase/migrations/20260802110000_assign_membership_role.sql:200-203`).
It is `SECURITY DEFINER` owned by `postgres`, so it bypasses RLS as well, but
the new INSERT guard cannot reach it.

**No browser client inserts a membership row.** A grep of `src/` for
`from('user_restaurants')` returns 7 `.select(` and 2 `.delete(` call sites and
**zero** `.insert(` or `.upsert(` call sites.

### Why the SECURITY DEFINER path is safe

Read live from production on 2026-08-08:

```
relname           rls_enabled  rls_forced  table_owner
user_restaurants  true         false       postgres
```

`relforcerowsecurity` is `false`, and `create_restaurant_with_owner` is owned by
`postgres`, which owns the table. Postgres does not apply RLS to a table's owner
unless `FORCE ROW LEVEL SECURITY` is set. No migration in the repo sets it —
a grep for `FORCE ROW LEVEL SECURITY` returns zero hits.

**Conclusion: the permissive INSERT grant for browser clients supports no
product flow. It is pure attack surface.**

---

## Approach considered

### Option A — mirror the UPDATE guard

Add a RESTRICTIVE INSERT policy with the same allowlist the UPDATE guard uses:
owner, or `role IN ('staff','kiosk')`.

Rejected. The staff/kiosk branch makes sense for UPDATE, where it permits a
**downgrade** of a membership that already exists. For INSERT it permits a
stranger to join a tenant they have no relationship with. Joining as `staff`
still grants access to that restaurant's data. That is the same class of
cross-tenant breach, one privilege level down.

### Option B — drop the redundant permissive policy only

Drop `Users can insert their own restaurant associations`. It is fully subsumed
by the `FOR ALL` policy's first disjunct.

Rejected on its own. The `FOR ALL` policy still carries
`user_id = auth.uid()`, so the hole survives.

### Option C — drop the redundant policy AND add a RESTRICTIVE INSERT guard (chosen)

1. Drop `Users can insert their own restaurant associations`. It grants nothing
   the `FOR ALL` policy does not already grant, and nothing uses it.
2. Add a RESTRICTIVE INSERT policy requiring
   `is_restaurant_owner(restaurant_id, auth.uid())`.

Effective INSERT check afterwards:

```
(user_id = auth.uid() OR is_restaurant_owner(...))   -- permissive, unchanged
AND is_restaurant_owner(restaurant_id, auth.uid())   -- new restrictive
⇒  is_restaurant_owner(restaurant_id, auth.uid())
```

A real owner can still add a member through a future UI. A stranger cannot
insert at any role. Every service-role and `SECURITY DEFINER` writer is
untouched.

**Why RESTRICTIVE and not a narrower permissive policy:** a permissive policy
can only widen access. It can never deny. `memory/lessons.md:848` records PR
#568 making this exact mistake on this exact table — the deny-guard was
permissive, the pre-existing `FOR ALL` policy ORed with it, and the escalation
still worked. A follow-up fix that narrowed the guard's `USING` clause changed
nothing.

---

## Change

**File:** `supabase/migrations/20260808100000_restrict_user_restaurants_insert.sql`

```sql
DROP POLICY IF EXISTS "Users can insert their own restaurant associations"
  ON public.user_restaurants;

-- Drop the new policy by its own name first, so a re-run of this file is a
-- refresh and not a "policy already exists" failure. Same pattern as
-- 20260730180000_close_role_id_self_escalation.sql:45-47.
DROP POLICY IF EXISTS "Only owners can insert restaurant associations"
  ON public.user_restaurants;

CREATE POLICY "Only owners can insert restaurant associations"
  ON public.user_restaurants
  AS RESTRICTIVE
  FOR INSERT
  TO public
  WITH CHECK (is_restaurant_owner(restaurant_id, auth.uid()));
```

`TO public` matches every existing policy on this table. `auth.uid()` is NULL
for `anon`, and `is_restaurant_owner` returns `EXISTS(...)`, which is `false`
for a NULL argument — never NULL. So `anon` is denied without a special case.

`is_restaurant_owner` reads `user_restaurants` from inside a policy **on**
`user_restaurants`. This does not recurse: the function is
`STABLE SECURITY DEFINER SET search_path TO 'public'` (read live from
production), so its own read runs as `postgres` and skips RLS. The existing
`FOR ALL` policy already calls it the same way.

**Migration prefix:** `20260808100000`. The newest prefix across all branches is
`20260806130000`, checked with
`git log --all --diff-filter=A --name-only -- 'supabase/migrations/*'`.
`memory/lessons.md:896` records a production deploy failure from a colliding
prefix.

---

## Tests

**File:** `supabase/tests/user_restaurants_insert_guard.test.sql`

Every deny case uses `throws_ok` **pinned to SQLSTATE `42501`**
(`insufficient_privilege`). `memory/lessons.md:851`: a deny-guard test that does
not prove the exception fires is the only thing that catches the permissive-OR
mistake. A bare `throws_ok` is not enough here — see the warning below.

| # | Case | Expect |
|---|---|---|
| 1 | Stranger inserts self as `owner` on another restaurant | throws `42501` |
| 2 | Stranger inserts self as `staff` on another restaurant | throws `42501` |
| 3 | Stranger inserts self as `manager` on another restaurant | throws `42501` |
| 4 | Existing `staff` member of A inserts self as `owner` on **restaurant B** | throws `42501` |
| 5 | Real owner inserts another user as `staff` | succeeds |
| 6 | Real owner inserts another user as `owner` | succeeds |
| 7 | `create_restaurant_with_owner` still creates the bootstrap owner row | succeeds |
| 8 | Non-vacuity control: `is_restaurant_owner` returns `false` for the stranger on A | passes |
| 9 | The new policy exists, is RESTRICTIVE, and is scoped to INSERT | passes |
| 10 | The dropped policy is gone | passes |
| 11 | `anon` cannot insert, even granted table-level INSERT (RLS denies it) | throws `42501` |

**Cases 1-4 are the non-vacuous ones.** Each is a *self*-insert, so
`user_id = auth.uid()` holds by construction and the permissive set admits the
row. Only the new RESTRICTIVE policy can deny it. `memory/lessons.md:866` — a
clause tested with a subject that another clause already authorizes proves
nothing.

**Warning: do not test a self-insert into a restaurant the subject already
belongs to.** `public.user_restaurants` has `UNIQUE(user_id, restaurant_id)`
(`supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:19`).
That INSERT raises `23505` (`unique_violation`) before RLS ever reports `42501`.
A bare `throws_ok` on such a case passes even if the RESTRICTIVE policy is
deleted. The SQLSTATE pin makes the trap impossible: a `23505` no longer counts
as a pass. Case 4 therefore targets **restaurant B**, where the subject holds no
row.

Case 7 guards the bootstrap path. A new user is not yet an owner when
`create_restaurant_with_owner` writes their first membership row. The test
proves the `SECURITY DEFINER` bypass holds. This is the highest-risk regression
in the change.

---

## Out of scope

- **`role_id` agreement on INSERT.** The UPDATE guard checks
  `role_id IS NULL OR role_id = builtin_role_id_for(role)`. The INSERT guard
  does not. Only an owner can now insert, and an owner may already assign any
  role, so this is a data-integrity concern, not a privilege one. Adding it
  risks breaking the custom-role path that `accept-invitation` writes
  (`role = 'collaborator_custom'` with a non-builtin `role_id`).
- **The `user_id = auth.uid()` disjunct for DELETE.** It lets a user leave a
  restaurant. `src/` has 2 `.delete(` call sites that rely on it. Keep it.
- **Vuln 2** (`restaurants` subscription columns) is Task 2, a separate PR.

## Decided trade-offs

- The permissive `FOR ALL` policy keeps its `user_id = auth.uid()` disjunct.
  Removing it would be cleaner but changes SELECT, UPDATE, and DELETE behaviour
  at the same time. The restrictive INSERT policy neutralizes it for INSERT
  alone, which is the smallest change that closes the hole.
- No E2E test. The exploit is a direct PostgREST call, not a UI flow, and no UI
  inserts memberships. pgTAP is the correct layer. Task 8's E2E work covers the
  signup surface.
