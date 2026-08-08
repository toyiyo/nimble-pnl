# Block self-grant of restaurant membership — implementation plan

Date: 2026-08-08
Branch: `fix/user-restaurants-insert-guard`
Design: [2026-08-08-user-restaurants-insert-guard-design.md](../specs/2026-08-08-user-restaurants-insert-guard-design.md)
Track A Task 1 of [2026-08-07-account-creation-security-plan.md](../../plans/2026-08-07-account-creation-security-plan.md)

Build order follows TDD. Write the test first. See it fail. Write the
migration. See it pass.

## Step 1 — Write the pgTAP test

Create `supabase/tests/user_restaurants_insert_guard.test.sql`.

Copy the RLS harness from `supabase/tests/user_restaurants_role_id_test.sql:250-274`:

```sql
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
-- assertions
RESET ROLE;
RESET request.jwt.claims;
```

As superuser the policies do not apply at all. The role switch is what makes
the test real.

### Fixtures

Two restaurants and four users. Use a `d0000000-…` id prefix, so the ids do
not collide with any other test file.

| Fixture | Purpose |
|---|---|
| restaurant A | the victim tenant |
| restaurant B | a second tenant, with no member from A |
| user OWNER | `owner` of restaurant A |
| user STRANGER | member of nothing |
| user STAFF | `staff` of restaurant A only |
| user TARGET | the person an owner adds; member of nothing |

Insert the fixtures as superuser, before the first `SET LOCAL ROLE`.

### Assertions

| # | Actor | Statement | Expect |
|---|---|---|---|
| 1 | STRANGER | insert self into A as `owner` | `throws_ok … '42501'` |
| 2 | STRANGER | insert self into A as `staff` | `throws_ok … '42501'` |
| 3 | STRANGER | insert self into A as `manager` | `throws_ok … '42501'` |
| 4 | STAFF of A | insert self into **B** as `owner` | `throws_ok … '42501'` |
| 5 | OWNER | insert TARGET into A as `staff` | `lives_ok` |
| 6 | OWNER | insert TARGET into A as `owner` | `lives_ok` |
| 7 | STRANGER | `create_restaurant_with_owner('…')` | `lives_ok` |
| 8 | — | `is_restaurant_owner('<A>', '<STRANGER>')` | `false` |
| 9 | — | the new policy is RESTRICTIVE and INSERT-scoped | `is` |
| 10 | — | `Users can insert their own restaurant associations` is gone | `is 0` |

Cases 5 and 6 both write TARGET into A, so run 5 first, then delete the row,
then run 6. A second insert of the same pair raises `23505`.

Warning: never point a deny case at a restaurant the actor already belongs to.
`UNIQUE(user_id, restaurant_id)`
(`supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:19`)
raises `23505` before RLS raises `42501`. The SQLSTATE pin on cases 1-4 makes
that mistake fail loudly instead of passing.

Case 7 is the bootstrap regression guard. Run it as STRANGER, who owns nothing
at that moment. It proves the `SECURITY DEFINER` bypass still works
(`supabase/migrations/20260129000000_add_subscription_system.sql:414-416`).

Case 8 is the non-vacuity control for cases 1-3. It proves STRANGER fails the
new `WITH CHECK` predicate, so the deny comes from the new policy and not from
some unrelated grant.

Cases 9 and 10 read `pg_policies`:

```sql
SELECT is(
  (SELECT permissive FROM pg_policies
    WHERE tablename = 'user_restaurants'
      AND policyname = 'Only owners can insert restaurant associations'),
  'RESTRICTIVE', '…');
```

Run case 7 in its own `SET LOCAL` block, and place it **last** among the write
cases. It creates a restaurant row that the earlier assertions do not expect.

### See it fail

```bash
npm run test:db
```

Cases 1-4 must fail now, because the hole is open. Cases 9 and 10 must fail
now, because the migration does not exist. Print the failure list before you
continue. A test that already passes proves nothing.

## Step 2 — Write the migration

Create `supabase/migrations/20260808100000_restrict_user_restaurants_insert.sql`
with the body in the design, section "Change".

The prefix `20260808100000` is free. The newest prefix across all branches is
`20260806130000`. `memory/lessons.md:896` records a deploy failure from a
colliding prefix.

Add a file header comment that states:
- what the policy denies,
- that every real writer bypasses RLS, with the four citations,
- that a permissive policy can never deny (`memory/lessons.md:848`).

## Step 3 — Delete the dead E2E helper that needs the hole

`tests/helpers/e2e-supabase.ts:618-661` defines `window.__inviteCollaborator`.
It calls `supabase.auth.signUp()`, which moves the browser session to the new
user, then upserts that user into a restaurant they do not own
(`tests/helpers/e2e-supabase.ts:645-655`). It works today only because of the
`user_id = auth.uid()` disjunct this task removes.

No spec calls it. A grep of `tests/` for `__inviteCollaborator` returns only
its own definition. Delete the helper.

Leave `window.__simulateCollaboratorRole`
(`tests/helpers/e2e-supabase.ts:663-690`). It UPDATEs an existing row, so the
INSERT guard does not reach it.

No other test writes a membership. `tests/helpers/auth.ts:30-40` uses the
service-role client and the RPC.

## Step 4 — See it pass

An already-applied migration needs a reset first (`memory/lessons.md:860`):

```bash
npm run db:reset && npm run test:db
```

All 10 cases must pass.

## Step 5 — Verify the rest

```bash
npm run typecheck && npm run lint && npm run test
```

Then the E2E signup and permissions specs, in the foreground, bounded by the
Bash tool `timeout` parameter. No poll loop (`CLAUDE.md`, "No Unbounded
Waits"):

```bash
npx playwright test tests/e2e/permissions-roles.spec.ts --reporter=line
```

## Order and dependencies

Step 1 first, and it must fail. Step 2 needs nothing. Step 3 is independent.
Step 4 needs 1 and 2. Step 5 needs 3 and 4.

## Out of scope

The design lists it. No `role_id` agreement check on INSERT. No change to the
DELETE path. No change to the permissive `FOR ALL` policy. Vuln 2 is Task 2.
