# Role Assignment (PR 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner or manager move an existing team member or collaborator into any role they could already invite them to — custom roles included — through a role-chip picker, backed by an RPC that raises on every denial instead of silently doing nothing.

**Architecture:** A `SECURITY DEFINER` Postgres RPC (`assign_membership_role`) owns the privilege decision, because `user_restaurants`' PERMISSIVE RLS policy makes another member's row untargetable by a manager — zero rows, no error, today's silent-failure bug. The RPC raises `42501` on every denial. On the client, a shared `RolePicker` popover replaces the `Badge` + `DropdownMenu` + `Select` stack on both Team members and Collaborators, previewing the permission delta before committing.

**Tech Stack:** Postgres 15 / pgTAP, React 18 + TypeScript, React Query, shadcn/ui (Popover + cmdk Command), Vitest, Playwright.

**Design spec:** `docs/superpowers/specs/2026-08-02-role-assignment-design.md` — read it before Task 1. Every rule implemented here is justified there.

## Global Constraints

- **Never write a bare `role` UPDATE on `user_restaurants`.** `role` and `role_id` go together in one statement, always. A `collaborator_custom` row with a NULL `role_id` is the zero-capability state.
- **Every denial raises `ERRCODE = '42501'`.** A definer function that returns zero rows reproduces the exact silent no-op this PR exists to kill.
- **Semantic tokens only** — `bg-background`, `text-foreground`, `border-border/40`, `--success`, `--destructive`. Never `bg-white`, never a hex value, never new `--positive`/`--negative` tokens (CLAUDE.md, No Direct Colors).
- **Loading / error / empty are all rendered explicitly** on every data-backed surface (CLAUDE.md, Always Handle States).
- **`useRoles` is `enabled: !!restaurantId`**, and a disabled React Query reports `isLoading === false`. Loading branches must key off a resolved `restaurantId` too, never `isLoading` alone.
- **Migration filenames use the `20260802HHMMSS_` prefix** — later than the `20260730…` roles-and-areas series, which is what orders them.
- **No `localStorage` caching.** React Query with `staleTime: 30000` only.
- Run from the worktree: `/Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment`, branch `feature/role-assignment`. Use `git -C <worktree>` for git — the shell's cwd has silently reset to the main repo on `main` once already this session.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260802100000_roles_legacy_role.sql` | **Create.** `roles.legacy_role` column + backfill + partial unique index + builtin-only CHECK. |
| `supabase/migrations/20260802110000_assign_membership_role.sql` | **Create.** The SQL invite matrix (`invitable_roles`, `can_invite_custom_role`) and the `assign_membership_role` RPC + grants. |
| `supabase/tests/assign_membership_role_test.sql` | **Create.** pgTAP: every rule and every denial path. |
| `supabase/tests/roles_legacy_role_test.sql` | **Create.** pgTAP: `legacy_role` agrees with `builtin_role_id_for` for all ten builtins; invariants hold. |
| `tests/unit/inviteMatrixMirror.test.ts` | **Modify.** Third parser pinning the SQL matrix to the TS and Deno copies. |
| `src/lib/permissions/areas.ts` | **Modify.** `SENSITIVE_FLAGS` moves here from `RoleEditor.tsx` so labels have one home. |
| `src/lib/permissions/roleDelta.ts` | **Create.** Pure `roleDelta(current, candidate)` — per-area-row and per-flag comparison. |
| `src/components/roles/RoleEditor.tsx` | **Modify.** Import `SENSITIVE_FLAGS` instead of defining it. |
| `src/hooks/useAssignRole.ts` | **Create.** React Query mutation wrapping the RPC, with `42501` message mapping. |
| `src/components/roles/RolePicker.tsx` | **Create.** The shared popover. Chip trigger + search + grouped options + delta. |
| `src/components/TeamMembers.tsx` | **Modify.** Replace the `Badge`+`DropdownMenu`+`Select` stack (lines 229–264) with `RolePicker`. |
| `src/components/CollaboratorInvitations.tsx` | **Modify.** Same picker on the collaborator rows. |
| `tests/unit/roleDelta.test.ts`, `tests/unit/useAssignRole.test.ts`, `tests/unit/RolePicker.test.tsx` | **Create.** |
| `tests/e2e/role-assignment.spec.ts` | **Create.** Owner moves a member into a custom role; it survives reload. |

Tasks 1–3 are server-side and land independently of the UI. Tasks 4–6 build the client pieces bottom-up. Tasks 7–8 wire them in. Task 9 proves it end to end.

---

### Task 1: `roles.legacy_role` — the builtin ↔ row mapping

The picker renders chips and a delta for builtin roles too, but nothing links the legacy string `'chef'` to row `b0000000-…-04`. That mapping lives only inside `builtin_role_id_for`, and no builtin UUID appears anywhere in `src/` — deliberately. This column is how the client gets the mapping without hardcoding UUIDs or matching on display names (`Employee (self-service)` vs the `ROLE_METADATA` label are maintained separately).

**Files:**
- Create: `supabase/migrations/20260802100000_roles_legacy_role.sql`
- Test: `supabase/tests/roles_legacy_role_test.sql`

**Interfaces:**
- Consumes: `public.builtin_role_id_for(TEXT) → UUID` (`20260730170000_…sql:102`), the ten seeded builtin rows (`20260730110000_seed_builtin_roles.sql:67-77`).
- Produces: `public.roles.legacy_role TEXT NULL` — the legacy role string on each builtin row, NULL on every custom role.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/roles_legacy_role_test.sql`:

```sql
-- roles.legacy_role — the builtin-role-string <-> roles-row mapping the client
-- reads so it never hardcodes a builtin UUID.
BEGIN;
SELECT plan(6);

-- A. The column exists and is nullable.
SELECT has_column('public', 'roles', 'legacy_role', 'roles.legacy_role exists');
SELECT col_is_null('public', 'roles', 'legacy_role', 'legacy_role is nullable (custom roles have none)');

-- B. All ten builtins agree with builtin_role_id_for. This is the whole point
--    of the column: if it drifts, the client resolves the wrong role.
SELECT is(
  (SELECT count(*)::int FROM public.roles r
    WHERE r.legacy_role IS NOT NULL
      AND public.builtin_role_id_for(r.legacy_role) = r.id),
  10,
  'all ten builtin rows round-trip through builtin_role_id_for'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE legacy_role IS NOT NULL),
  10,
  'exactly ten rows carry a legacy_role — no more, no fewer'
);

-- C. The invariants are enforced by the database, not by this test alone.
SELECT throws_ok(
  $$ UPDATE public.roles SET legacy_role = 'manager'
     WHERE id = 'b0000000-0000-0000-0000-000000000004' $$,
  '23505',
  NULL,
  'a duplicated legacy_role is rejected by the partial unique index'
);

SELECT throws_ok(
  $$ INSERT INTO public.roles (restaurant_id, name, flavor, builtin, legacy_role)
     VALUES (NULL, 'Bogus', 'collaborator', false, 'staff') $$,
  '23514',
  NULL,
  'a non-builtin row cannot carry a legacy_role'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test:db -- roles_legacy_role_test.sql
```

Expected: FAIL — `column "legacy_role" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260802100000_roles_legacy_role.sql`:

```sql
-- ============================================================================
-- roles.legacy_role — the builtin-role-string <-> roles-row mapping, exposed.
--
-- The role picker (2026-08-02-role-assignment-design.md) renders area chips
-- and a permission delta for builtin roles as well as custom ones, so the
-- client needs to resolve 'chef' -> the Chef roles row. That mapping exists
-- only inside builtin_role_id_for(), and no builtin UUID appears anywhere in
-- src/ — deliberately. Matching on display name is not an option either: the
-- DB names ('Employee (self-service)') and ROLE_METADATA's labels are
-- maintained separately, so a rename would break the join silently.
--
-- builtin_role_id_for() is deliberately NOT rewritten to read this column. It
-- is IMMUTABLE and referenced inside a RESTRICTIVE policy's WITH CHECK
-- (20260730180000_close_role_id_self_escalation.sql); reading a table would
-- force it to STABLE, which is a change to a security-critical function this
-- work has no reason to make. A pgTAP test asserts the two agree instead.
-- ============================================================================

ALTER TABLE public.roles ADD COLUMN legacy_role TEXT;

COMMENT ON COLUMN public.roles.legacy_role IS
'The user_restaurants.role string this builtin row corresponds to. NULL for every custom role, which has no legacy string — every custom role shares ''collaborator_custom'' and is distinguished by id alone. Read by the client to map a builtin role string to its roles row without hardcoding builtin UUIDs.';

-- Backfilled through builtin_role_id_for rather than by re-listing the pairs,
-- so this migration cannot introduce a mapping the function disagrees with.
UPDATE public.roles r
SET legacy_role = m.legacy_role
FROM (VALUES
  ('owner'), ('manager'), ('operations_manager'), ('chef'), ('staff'),
  ('kiosk'), ('collaborator_accountant'), ('collaborator_inventory'),
  ('collaborator_chef'), ('collaborator_operations_manager')
) AS m(legacy_role)
WHERE r.id = public.builtin_role_id_for(m.legacy_role);

-- Invariants in the database, not only in a test. A pgTAP agreement test
-- catches drift only if CI runs and the test was not itself edited to match
-- the mistake; the index catches a duplicate unconditionally, in production.
CREATE UNIQUE INDEX roles_legacy_role_key ON public.roles (legacy_role)
  WHERE legacy_role IS NOT NULL;

ALTER TABLE public.roles ADD CONSTRAINT roles_legacy_role_builtin_only
  CHECK (legacy_role IS NULL OR builtin);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run db:reset && npm run test:db -- roles_legacy_role_test.sql
```

Expected: PASS, 6/6.

- [ ] **Step 5: Add `legacy_role` to the `useRoles` select**

In `src/hooks/useRoles.ts`, add `legacy_role,` to `ROLES_SELECT` (after `builtin,`, line ~65) and `legacy_role: string | null;` to the `RoleWithGrants` interface (after `builtin: boolean;`).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add supabase/migrations/20260802100000_roles_legacy_role.sql supabase/tests/roles_legacy_role_test.sql src/hooks/useRoles.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): map builtin roles to their rows via roles.legacy_role"
```

---

### Task 2: The SQL invite matrix

The third copy of the invite matrix — TS, Deno, now SQL. Task 3 pins all three together. Split from Task 3 so a reviewer can reject the matrix contents without rejecting the drift guard, and from Task 4 so the RPC lands on a matrix that already exists.

**Files:**
- Create: `supabase/migrations/20260802110000_assign_membership_role.sql` (matrix half; the RPC lands in Task 4 of this same file — write the matrix first and commit)

**Interfaces:**
- Produces:
  - `public.invitable_roles(p_inviter TEXT) → TEXT[]` — the target roles that inviter may assign; NULL for an inviter with no row.
  - `public.can_invite_custom_role(p_inviter TEXT) → BOOLEAN`

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/assign_membership_role_test.sql` with just the matrix assertions for now:

```sql
BEGIN;
SELECT plan(5);

SELECT is(
  public.invitable_roles('owner'),
  ARRAY['owner','manager','operations_manager','chef','staff',
        'collaborator_accountant','collaborator_inventory','collaborator_chef',
        'collaborator_operations_manager'],
  'the owner row matches src/lib/permissions/invitations.ts:14-18'
);

SELECT is(
  public.invitable_roles('manager'),
  ARRAY['manager','operations_manager','chef','staff',
        'collaborator_accountant','collaborator_inventory','collaborator_chef',
        'collaborator_operations_manager'],
  'a manager may not assign owner'
);

SELECT is(public.invitable_roles('operations_manager'), ARRAY['staff'],
  'operations_manager reaches staff only');

SELECT ok(public.invitable_roles('staff') IS NULL,
  'a role with no matrix row gets NULL, not an empty array that reads as "checked and allowed nothing"');

-- kiosk is absent from every row by design: a kiosk is a shared device
-- credential, not a person (src/lib/permissions/invitations.ts:12-13).
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM (VALUES ('owner'),('manager'),('operations_manager')) AS i(r)
    WHERE 'kiosk' = ANY (public.invitable_roles(i.r))
  ),
  'nobody can assign kiosk'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npm run test:db -- assign_membership_role_test.sql
```

Expected: FAIL — `function public.invitable_roles(unknown) does not exist`.

- [ ] **Step 3: Write the matrix**

Create `supabase/migrations/20260802110000_assign_membership_role.sql`:

```sql
-- ============================================================================
-- assign_membership_role — change an existing member's role.
--
-- See docs/superpowers/specs/2026-08-02-role-assignment-design.md.
--
-- Why this is a SECURITY DEFINER RPC and not a client UPDATE: the PERMISSIVE
-- policy on user_restaurants ("Owners can manage restaurant associations")
-- has USING (user_id = auth.uid() OR is_restaurant_owner(...)). A manager
-- updating another member's row matches neither branch, so zero rows match --
-- and Postgres raises no error for a row RLS filtered away. TeamMembers.tsx
-- checks only { error } and then fires a success toast, so a manager changing
-- anyone's role today sees "Member role updated successfully" while nothing
-- changed. This function therefore RAISES on every denial; returning zero
-- rows would reproduce the exact bug it exists to kill.
--
-- The cost is a third copy of the invite matrix (TS, Deno, now SQL).
-- tests/unit/inviteMatrixMirror.test.ts parses all three and pins them
-- together.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- The invite matrix, mirroring INVITABLE_ROLES in
-- src/lib/permissions/invitations.ts and the Deno copy in
-- supabase/functions/send-team-invitation/index.ts.
--
-- Rows with no targets (chef, staff, kiosk, every collaborator role) are
-- omitted rather than listed empty: a missing row returns NULL, and the
-- caller treats NULL as "assign nothing", which is the same default-deny the
-- TS matrix gets from an empty array. 'kiosk' appears in no row's targets --
-- a kiosk is a shared device credential, not a person.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invitable_roles(p_inviter TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT m.targets
  FROM (VALUES
    ('owner', ARRAY['owner','manager','operations_manager','chef','staff',
                    'collaborator_accountant','collaborator_inventory',
                    'collaborator_chef','collaborator_operations_manager']),
    ('manager', ARRAY['manager','operations_manager','chef','staff',
                      'collaborator_accountant','collaborator_inventory',
                      'collaborator_chef','collaborator_operations_manager']),
    ('operations_manager', ARRAY['staff'])
  ) AS m(inviter, targets)
  WHERE m.inviter = p_inviter;
$$;

COMMENT ON FUNCTION public.invitable_roles IS
'Target roles an inviter role may assign. Third copy of the invite matrix (TS: src/lib/permissions/invitations.ts, Deno: send-team-invitation). Returns NULL for a role with no row, which callers must treat as deny. Pinned to the other two by tests/unit/inviteMatrixMirror.test.ts.';

-- Mirrors CUSTOM_ROLE_INVITERS (src/lib/permissions/invitations.ts:49).
CREATE OR REPLACE FUNCTION public.can_invite_custom_role(p_inviter TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_inviter = ANY (ARRAY['owner','manager']);
$$;

COMMENT ON FUNCTION public.can_invite_custom_role IS
'Whether an inviter role may assign a custom role. Mirrors CUSTOM_ROLE_INVITERS in src/lib/permissions/invitations.ts and send-team-invitation.';
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run db:reset && npm run test:db -- assign_membership_role_test.sql
```

Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add supabase/migrations/20260802110000_assign_membership_role.sql supabase/tests/assign_membership_role_test.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): the invite matrix in SQL"
```

---

### Task 3: Pin the SQL matrix to the TS and Deno copies

`tests/unit/inviteMatrixMirror.test.ts` exists solely to stop TS↔Deno drift by parsing both source files textually. A third copy without a third parser is the copy that drifts.

**Files:**
- Modify: `tests/unit/inviteMatrixMirror.test.ts`

**Interfaces:**
- Consumes: `public.invitable_roles` and `public.can_invite_custom_role` from Task 2.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/inviteMatrixMirror.test.ts`, above the closing `});` of the existing `describe`:

```typescript
  it('the SQL matrix matches the TS matrix row for row', () => {
    // The third copy. SQL omits empty rows entirely (a missing row returns
    // NULL, which the RPC treats as deny), so only the non-empty TS rows are
    // compared — the same rule the existing TS<->Deno assertion uses.
    const sql = parseSqlMatrix(readLatestSqlMatrix());
    const tsNonEmpty = Object.fromEntries(
      Object.entries(ts).filter(([, targets]) => targets.length > 0)
    );
    expect(sql).toEqual(tsNonEmpty);
  });

  it('the SQL custom-role inviter list matches the TS one', () => {
    expect(parseSqlCustomRoleInviters(readLatestSqlMatrix()))
      .toEqual(parseCustomRoleInviters(read(TS_PATH), TS_PATH));
  });
```

And add these helpers above `describe`:

```typescript
import { readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';

/**
 * The migration that currently defines the SQL matrix.
 *
 * Migrations are append-only, so a future change to the matrix arrives as a
 * NEW file with CREATE OR REPLACE. Pinning this test to one filename would
 * leave it asserting against a superseded definition — passing while the
 * live matrix drifts. Picking the lexicographically-last definer matches
 * what the database actually ran.
 */
function readLatestSqlMatrix(): string {
  const dir = resolve(process.cwd(), MIGRATIONS_DIR);
  const definers = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) =>
      readFileSync(resolve(dir, f), 'utf8').includes(
        'FUNCTION public.invitable_roles'
      )
    )
    .sort();
  expect(definers.length, 'no migration defines public.invitable_roles').toBeGreaterThan(0);
  return readFileSync(resolve(dir, definers[definers.length - 1]), 'utf8');
}

/** Parse the `('owner', ARRAY['a','b']), …` VALUES list into a plain object. */
function parseSqlMatrix(source: string): Record<string, string[]> {
  const start = source.indexOf('FUNCTION public.invitable_roles');
  expect(start, 'invitable_roles not found in the SQL').toBeGreaterThan(-1);
  const body = source.slice(start);
  const matrix: Record<string, string[]> = {};
  const entry = /\(\s*'(\w+)'\s*,\s*ARRAY\[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(body)) !== null) {
    matrix[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((r) => r[1]);
  }
  return matrix;
}

/** Parse the ARRAY[...] literal inside can_invite_custom_role. */
function parseSqlCustomRoleInviters(source: string): string[] {
  const start = source.indexOf('FUNCTION public.can_invite_custom_role');
  expect(start, 'can_invite_custom_role not found in the SQL').toBeGreaterThan(-1);
  const match = /ARRAY\[([^\]]*)\]/.exec(source.slice(start));
  expect(match, 'no ARRAY literal in can_invite_custom_role').not.toBeNull();
  return [...match![1].matchAll(/'([^']+)'/g)].map((r) => r[1]);
}
```

- [ ] **Step 2: Run it to verify it passes**

Both new assertions should pass immediately — Task 2 wrote the matrix to match. That is expected: this is a *guard*, not a driver. Prove it actually guards by breaking it on purpose:

```bash
npm run test -- inviteMatrixMirror
```

Expected: PASS.

- [ ] **Step 3: Verify the guard actually catches drift**

Temporarily delete `'chef'` from the `manager` row in `supabase/migrations/20260802110000_assign_membership_role.sql`, then:

```bash
npm run test -- inviteMatrixMirror
```

Expected: FAIL on "the SQL matrix matches the TS matrix row for row". **Restore the deleted entry** and re-run to confirm PASS. A guard never observed failing is not known to guard anything.

- [ ] **Step 4: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add tests/unit/inviteMatrixMirror.test.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "test(permissions): pin the SQL invite matrix to the TS and Deno copies"
```

---

### Task 4: The `assign_membership_role` RPC

The privilege decision. Seven rules, each raising `42501`.

**Files:**
- Modify: `supabase/migrations/20260802110000_assign_membership_role.sql` (append the RPC)
- Modify: `supabase/tests/assign_membership_role_test.sql` (append rule coverage)

**Interfaces:**
- Consumes: `public.invitable_roles`, `public.can_invite_custom_role` (Task 2); `public.builtin_role_id_for` (existing).
- Produces: `public.assign_membership_role(p_membership_id UUID, p_role TEXT, p_role_id UUID DEFAULT NULL) → VOID`. Raises `42501` on every denial.

- [ ] **Step 1: Write the failing tests**

Replace the `SELECT plan(5);` line in `supabase/tests/assign_membership_role_test.sql` with `SELECT plan(25);` and append these cases before `SELECT * FROM finish();`.

Fixtures first — two restaurants, an owner, a second owner, a manager, a staff member, a kiosk, and a custom role:

```sql
-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'owner1@test.local'),
  ('a0000000-0000-0000-0000-000000000002', 'owner2@test.local'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test.local'),
  ('a0000000-0000-0000-0000-000000000004', 'staff@test.local'),
  ('a0000000-0000-0000-0000-000000000005', 'kiosk@test.local'),
  ('a0000000-0000-0000-0000-000000000006', 'outsider@test.local');

INSERT INTO public.restaurants (id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'Test Kitchen'),
  ('c0000000-0000-0000-0000-000000000002', 'Other Kitchen');

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   'c0000000-0000-0000-0000-000000000001', 'owner',   public.builtin_role_id_for('owner')),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   'c0000000-0000-0000-0000-000000000001', 'owner',   public.builtin_role_id_for('owner')),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
   'c0000000-0000-0000-0000-000000000001', 'manager', public.builtin_role_id_for('manager')),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004',
   'c0000000-0000-0000-0000-000000000001', 'staff',   public.builtin_role_id_for('staff')),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005',
   'c0000000-0000-0000-0000-000000000001', 'kiosk',   public.builtin_role_id_for('kiosk'));

-- A custom role in restaurant 1, and one in restaurant 2 for the cross-tenant case.
INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   'Operations Lead', 'collaborator', false),
  ('e0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002',
   'Other Tenant Role', 'collaborator', false);

-- ---------------------------------------------------------------- helper
-- Same shape as pg_temp.as_user_copy in copy_role_to_restaurants_test.sql:
-- switch role + jwt claims, run, switch back, never let the exception escape
-- (an escaping exception aborts the transaction and ROLLBACK fires before
-- finish() reports).
--
-- Returns the SQLSTATE rather than a bare 'raised' sentinel, because every
-- assertion below cares specifically that the denial is 42501 -- a typo
-- raising 42883 (undefined function) would satisfy "it raised" while proving
-- nothing about the privilege check.
CREATE OR REPLACE FUNCTION pg_temp.as_user_assign(
  p_user_id       UUID,
  p_membership_id UUID,
  p_role          TEXT,
  p_role_id       UUID DEFAULT NULL
) RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  BEGIN
    PERFORM public.assign_membership_role(p_membership_id, p_role, p_role_id);
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', 'postgres', true);
    RETURN SQLSTATE;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN 'ok';
END;
$$;
```

Then the assertions. `OWNER1 = …0001`, `OWNER2 = …0002`, `MGR = …0003`, `OUTSIDER = …0006`; memberships `M_OWNER1 = …0001`, `M_OWNER2 = …0002`, `M_MGR = …0003`, `M_STAFF = …0004`, `M_KIOSK = …0005`:

```sql
-- ---- The bug this whole function exists to kill -------------------------
-- Asserted as a state change, not merely "no exception": the old path also
-- raised nothing, and that was the problem.
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'chef'),
  'ok', 'a manager may move a staff member to chef');
SELECT is(
  (SELECT role FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  'chef', 'the role column actually changed');
SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  public.builtin_role_id_for('chef'),
  'role_id was written explicitly, not left to the sync trigger');

-- ---- Rule 2: never self-target -----------------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000003'::uuid, 'staff'),
  '42501', 'a caller cannot change their own role');

-- ---- Rule 3: caller with no membership row -----------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000006'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'staff'),
  '42501', 'a caller with no membership in the restaurant is denied');

-- ---- Rule 4: the matrix, both directions -------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'owner'),
  '42501', 'a manager cannot assign owner — not in the manager row');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'kiosk'),
  '42501', 'nobody can be moved INTO kiosk');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000005'::uuid, 'staff'),
  '42501', 'a kiosk credential cannot be converted into a person');

-- ---- Rule 5: owners ----------------------------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000001'::uuid, 'staff'),
  '42501', 'a manager cannot demote an owner');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid, 'manager'),
  'ok', 'an owner may demote a second owner while two remain');

-- owner2 is now a manager, so owner1 is the sole owner. Nobody can demote
-- them: a manager is stopped by rule 5a, and owner1 is stopped by rule 2.
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000002'::uuid,
    'd0000000-0000-0000-0000-000000000001'::uuid, 'manager'),
  '42501', 'the sole owner cannot be demoted by the manager they just created');

-- Promoting back TO owner is its own path — only the owner matrix row
-- contains 'owner', so this also re-asserts rule 4 in the allowed direction.
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'd0000000-0000-0000-0000-000000000002'::uuid, 'owner'),
  'ok', 'an owner may promote someone back to owner');

-- ---- Rule 6: custom roles ----------------------------------------------
SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom'),
  '42501', 'collaborator_custom without a role_id is refused');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'staff',
    'e0000000-0000-0000-0000-000000000001'::uuid),
  '42501', 'a builtin role WITH a role_id is a caller error, not a silent preference');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom',
    'e0000000-0000-0000-0000-000000000002'::uuid),
  '42501', 'another tenant''s role_id is refused');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom',
    public.builtin_role_id_for('staff')),
  '42501', 'a global builtin role_id is refused as a custom role');

SELECT is(
  pg_temp.as_user_assign(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    'd0000000-0000-0000-0000-000000000004'::uuid, 'collaborator_custom',
    'e0000000-0000-0000-0000-000000000001'::uuid),
  'ok', 'a manager may assign this restaurant''s own custom role');

SELECT is(
  (SELECT role || '/' || role_id::text FROM public.user_restaurants
    WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  'collaborator_custom/e0000000-0000-0000-0000-000000000001',
  'both columns were written together — never collaborator_custom with a NULL role_id');

-- ---- Grants ------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.assign_membership_role(uuid,text,uuid)', 'EXECUTE'),
  'anon cannot execute the RPC');
SELECT ok(
  has_function_privilege('authenticated',
    'public.assign_membership_role(uuid,text,uuid)', 'EXECUTE'),
  'authenticated can execute the RPC');
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run db:reset && npm run test:db -- assign_membership_role_test.sql
```

Expected: FAIL — `function public.assign_membership_role(...) does not exist`.

- [ ] **Step 3: Append the RPC to the migration**

Append to `supabase/migrations/20260802110000_assign_membership_role.sql`:

```sql
-- ----------------------------------------------------------------------------
-- assign_membership_role — the write path.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_membership_role(
  p_membership_id UUID,
  p_role          TEXT,
  p_role_id       UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id      UUID;
  v_target_user_id     UUID;
  v_current_role       TEXT;
  v_caller_role        TEXT;
  v_owner_count        INT;
  v_role_restaurant_id UUID;
  v_role_found         BOOLEAN;
BEGIN
  -- Rule 1: the membership must exist, and ITS restaurant_id is authoritative.
  -- Restaurant scope is never taken from client input.
  SELECT restaurant_id, user_id, role
    INTO v_restaurant_id, v_target_user_id, v_current_role
  FROM public.user_restaurants
  WHERE id = p_membership_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership not found'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 2: never self-target. Self-escalation is exactly what the RESTRICTIVE
  -- policy protects against, and no UI surface needs it.
  IF v_target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You cannot change your own role'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 3: resolve the caller's role IN THAT RESTAURANT. A caller with no
  -- membership row is denied on its own named path, distinct from a matrix
  -- miss -- this is where an unauthenticated or cross-tenant caller lands, so
  -- it must deny explicitly rather than fall through a lookup returning NULL.
  SELECT role INTO v_caller_role
  FROM public.user_restaurants
  WHERE restaurant_id = v_restaurant_id
    AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not a member of this restaurant'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 4 (second direction): the matrix cannot express "may not be moved
  -- OUT of kiosk", so it is its own rule. Converting a shared device
  -- credential into a person's account is not a role change.
  IF v_current_role = 'kiosk' THEN
    RAISE EXCEPTION 'A kiosk is a shared device credential and cannot be given a person''s role'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 5a: only an owner may change a member who is currently an owner.
  -- Without this a manager could demote the owner, since 'staff' sits in the
  -- manager's matrix row.
  IF v_current_role = 'owner' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only an owner can change an owner''s role'
      USING ERRCODE = '42501';
  END IF;

  -- Rule 5b: the last owner cannot be demoted, or the restaurant orphans
  -- itself. LOCK BEFORE COUNTING: counted without the lock this is a
  -- check-then-act race -- with two owners, two concurrent demotions each
  -- read count = 2, each pass, and both commit, leaving zero owners. That is
  -- precisely the orphaning this rule exists to prevent, so the rule is only
  -- real with the lock.
  IF v_current_role = 'owner' AND p_role <> 'owner' THEN
    SELECT count(*) INTO v_owner_count
    FROM (
      SELECT 1
      FROM public.user_restaurants
      WHERE restaurant_id = v_restaurant_id
        AND role = 'owner'
      FOR UPDATE
    ) AS locked_owners;

    IF v_owner_count <= 1 THEN
      RAISE EXCEPTION 'This is the last owner. Promote someone else to owner first.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Rule 6: custom role, or builtin -- never ambiguously both.
  IF p_role = 'collaborator_custom' THEN
    IF p_role_id IS NULL THEN
      RAISE EXCEPTION 'A custom role requires a role id'
        USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_invite_custom_role(v_caller_role) THEN
      RAISE EXCEPTION 'Your role cannot assign custom roles'
        USING ERRCODE = '42501';
    END IF;

    -- Must belong to THIS restaurant: never a global builtin
    -- (restaurant_id IS NULL), never another tenant's.
    SELECT restaurant_id, true INTO v_role_restaurant_id, v_role_found
    FROM public.roles
    WHERE id = p_role_id;

    IF NOT FOUND OR v_role_restaurant_id IS DISTINCT FROM v_restaurant_id THEN
      RAISE EXCEPTION 'That role does not belong to this restaurant'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Passing a role_id alongside a builtin role is a caller error, not a
    -- silent preference: the two would disagree about what was granted.
    IF p_role_id IS NOT NULL THEN
      RAISE EXCEPTION 'A builtin role cannot carry a role id'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (p_role = ANY (COALESCE(public.invitable_roles(v_caller_role), ARRAY[]::TEXT[]))) THEN
      RAISE EXCEPTION 'Your role cannot assign that role'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Rule 7: both columns together, per the path
  -- 20260730170000_invitation_role_id_and_membership_role_sync.sql:62 names.
  -- Builtins get their role_id written EXPLICITLY rather than left to the sync
  -- trigger, which fires only when role changes and role_id does not. Writing
  -- both means the caller always wins, and the row is never a
  -- collaborator_custom with a NULL role_id -- the zero-capability state.
  UPDATE public.user_restaurants
  SET role    = p_role,
      role_id = COALESCE(p_role_id, public.builtin_role_id_for(p_role))
  WHERE id = p_membership_id;
END;
$$;

COMMENT ON FUNCTION public.assign_membership_role IS
'Changes an existing member''s role, enforcing the invite matrix for the caller''s role in that restaurant. Raises 42501 on every denial rather than filtering: a SECURITY DEFINER function returning zero rows would reproduce the silent no-op this replaces (a manager''s bare UPDATE on user_restaurants matches no PERMISSIVE policy branch, affects zero rows, and raises nothing). Writes role and role_id together so a custom-role membership can never land with a NULL role_id.';

-- Explicit, not incidental. copy_role_to_restaurants -- the function this one
-- is modelled on -- grants EXECUTE to authenticated but never revokes the
-- default PUBLIC grant, and fails closed only because its internal check keys
-- off auth.uid(), which is NULL for anon. A role-administration RPC that
-- raises rather than filters should not rely on that.
REVOKE EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.assign_membership_role(uuid, text, uuid) TO authenticated;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run db:reset && npm run test:db -- assign_membership_role_test.sql
```

Expected: PASS, 25/25. If a fixture INSERT fails on a NOT NULL column this plan didn't anticipate, add the column to the fixture — do not weaken an assertion.

- [ ] **Step 5: Regenerate Supabase types**

```bash
npm run db:reset
npx supabase gen types typescript --local > src/integrations/supabase/types.ts
npm run typecheck
```

Expected: `assign_membership_role` appears under `Database['public']['Functions']`, and `roles.Row` gains `legacy_role`.

- [ ] **Step 6: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add supabase/migrations/20260802110000_assign_membership_role.sql supabase/tests/assign_membership_role_test.sql src/integrations/supabase/types.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): assign_membership_role RPC that raises instead of silently no-op'ing"
```

**Two cases pgTAP structurally cannot cover here, named rather than left silent.**

**The last-owner branch (rule 5b) is unreachable single-threaded, by construction.** Reaching it requires the caller to be an owner (rule 5a) and not the target (rule 2), so at read time two distinct owners exist and the count can never be ≤ 1. No sequential test can drive it — which is exactly the point: rule 5b exists *only* for the concurrent case. Two owners demoting each other simultaneously both read `caller_role = 'owner'` from their own unchanged rows, both pass rule 5a, and both commit, leaving zero owners. The `FOR UPDATE` is what serializes them: under READ COMMITTED the second transaction blocks on the lock, re-evaluates after the first commits, sees the demoted row no longer matching `role = 'owner'`, and denies. That behaviour needs two connections and the harness runs one inside `BEGIN … ROLLBACK`, so it is reasoned, not proven. Do not "simplify" the branch away because no test covers it, and do not add a test that appears to cover it — an assertion that actually trips rule 2 while claiming to prove rule 5b is worse than the acknowledged gap.

**A genuinely anonymous caller** is approximated by an unknown `sub` claim, which lands on the same rule-3 denial path but is not literally `auth.uid() IS NULL`. The `anon` EXECUTE-grant assertion is the real guard there.

---

### Task 5: `roleDelta` — what actually changes

The seam that makes the picker honest. `buildRolePreview` returns `{summary, navPreview, grantCount}` — no capability set to diff. Diffing `summary` strings would silently miss two of the three sensitive flags, because `buildSummary`'s blocked-list checks only `view:costs` (`preview.ts:159`), and `navPreview` doesn't represent flags at all. A move flipping only `view:pay_rates` would render "same areas" at the exact moment pay-rate visibility changed hands.

**Files:**
- Create: `src/lib/permissions/roleDelta.ts`
- Modify: `src/lib/permissions/areas.ts` (receive `SENSITIVE_FLAGS`)
- Modify: `src/components/roles/RoleEditor.tsx` (import it instead of defining it)
- Test: `tests/unit/roleDelta.test.ts`

**Interfaces:**
- Consumes: `AREA_DEFINITIONS`, `grantMap` (`areas.ts:407`), `rowLevel` (`preview.ts:91`), `AreaLevel`, `SensitiveFlag`.
- Produces:
  ```typescript
  export interface RoleGrantSet {
    areas: ReadonlyArray<{ area_key: AreaKey; level: AreaLevel }>;
    flags: readonly SensitiveFlag[];
  }
  export interface AreaDeltaLine {
    label: string;
    from: AreaLevel | null;
    to: AreaLevel | null;
  }
  export interface FlagDeltaLine { flag: SensitiveFlag; label: string; }
  export interface RoleDelta {
    gains: AreaDeltaLine[];
    loses: AreaDeltaLine[];
    flagGains: FlagDeltaLine[];
    flagLoses: FlagDeltaLine[];
    isSame: boolean;
  }
  export function roleDelta(current: RoleGrantSet, candidate: RoleGrantSet): RoleDelta;
  ```

- [ ] **Step 1: Move `SENSITIVE_FLAGS` into `areas.ts`**

Cut the `SENSITIVE_FLAGS` array from `src/components/roles/RoleEditor.tsx:141-165` and paste it into `src/lib/permissions/areas.ts` below the `SensitiveFlag` type (line 57), exported:

```typescript
/**
 * The three sensitive-data flags with their human labels.
 *
 * Lived in RoleEditor.tsx until the role picker's delta needed the same
 * labels. Two copies of "Employee pay rates" is how a screen ends up naming
 * a permission differently from the screen that grants it.
 */
export const SENSITIVE_FLAGS: ReadonlyArray<{
  flag: SensitiveFlag;
  name: string;
  hint: string;
  requires: readonly AreaKey[];
}> = [
  {
    flag: 'view:costs',
    name: 'Item costs & margins',
    hint: 'Unit costs, recipe cost, plate margin',
    requires: ['inventory', 'recipes', 'reports'],
  },
  {
    flag: 'view:pay_rates',
    name: 'Employee pay rates',
    hint: 'Hourly and salary amounts on the roster and schedule',
    requires: ['employees', 'scheduling'],
  },
  {
    flag: 'view:employee_pii',
    name: 'Contact details & tax IDs',
    hint: 'Phone, address, last 4 of SSN',
    requires: ['employees'],
  },
];
```

In `RoleEditor.tsx`, delete the local definition and add `SENSITIVE_FLAGS` to the existing import from `@/lib/permissions/areas`.

```bash
npm run typecheck
```

Expected: clean. `RoleEditor.tsx` still compiles — `SENSITIVE_FLAGS[number]` is used at line 174 and the shape is unchanged.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/roleDelta.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { roleDelta } from '@/lib/permissions/roleDelta';
import type { RoleGrantSet } from '@/lib/permissions/roleDelta';

const set = (
  areas: RoleGrantSet['areas'],
  flags: RoleGrantSet['flags'] = []
): RoleGrantSet => ({ areas, flags });

describe('roleDelta', () => {
  it('reports a newly granted area as a gain, with its human label', () => {
    const d = roleDelta(set([]), set([{ area_key: 'recipes', level: 'manage' }]));
    expect(d.gains).toHaveLength(1);
    expect(d.gains[0]).toMatchObject({ from: null, to: 'manage' });
    expect(d.gains[0].label).toBeTruthy();
    expect(d.loses).toHaveLength(0);
    expect(d.isSame).toBe(false);
  });

  it('reports a removed area as a loss', () => {
    const d = roleDelta(set([{ area_key: 'recipes', level: 'manage' }]), set([]));
    expect(d.loses).toHaveLength(1);
    expect(d.loses[0]).toMatchObject({ from: 'manage', to: null });
    expect(d.gains).toHaveLength(0);
  });

  it('treats view -> manage as a gain rather than collapsing it', () => {
    const d = roleDelta(
      set([{ area_key: 'recipes', level: 'view' }]),
      set([{ area_key: 'recipes', level: 'manage' }])
    );
    expect(d.gains).toHaveLength(1);
    expect(d.gains[0]).toMatchObject({ from: 'view', to: 'manage' });
  });

  it('treats manage -> view as a loss', () => {
    const d = roleDelta(
      set([{ area_key: 'recipes', level: 'manage' }]),
      set([{ area_key: 'recipes', level: 'view' }])
    );
    expect(d.loses).toHaveLength(1);
    expect(d.loses[0]).toMatchObject({ from: 'manage', to: 'view' });
  });

  it('reports identical grants as the same', () => {
    const areas = [{ area_key: 'recipes' as const, level: 'manage' as const }];
    const d = roleDelta(set(areas, ['view:costs']), set(areas, ['view:costs']));
    expect(d.isSame).toBe(true);
    expect(d.gains).toHaveLength(0);
    expect(d.loses).toHaveLength(0);
    expect(d.flagGains).toHaveLength(0);
    expect(d.flagLoses).toHaveLength(0);
  });

  // The case this function exists for. Identical areas, one flag different.
  // buildRolePreview's summary would read the same for both, because its
  // blocked-list checks only view:costs — so a summary diff would report
  // "nothing changed" while pay-rate visibility changed hands.
  it.each([
    ['view:costs'],
    ['view:pay_rates'],
    ['view:employee_pii'],
  ] as const)('detects a flag-only change: %s', (flag) => {
    const areas = [{ area_key: 'employees' as const, level: 'view' as const }];
    const gained = roleDelta(set(areas, []), set(areas, [flag]));
    expect(gained.isSame).toBe(false);
    expect(gained.flagGains.map((f) => f.flag)).toEqual([flag]);
    expect(gained.gains).toHaveLength(0);

    const lost = roleDelta(set(areas, [flag]), set(areas, []));
    expect(lost.isSame).toBe(false);
    expect(lost.flagLoses.map((f) => f.flag)).toEqual([flag]);
  });

  it('every flag carries a human label, not the raw literal', () => {
    const areas = [{ area_key: 'employees' as const, level: 'view' as const }];
    const d = roleDelta(set(areas, []), set(areas, ['view:pay_rates']));
    expect(d.flagGains[0].label).toBe('Employee pay rates');
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npm run test -- roleDelta
```

Expected: FAIL — cannot resolve `@/lib/permissions/roleDelta`.

- [ ] **Step 4: Implement**

Create `src/lib/permissions/roleDelta.ts`:

```typescript
/**
 * What actually changes when a member moves between two roles.
 *
 * Deliberately NOT derived from `buildRolePreview`. `RolePreview` is
 * `{summary, navPreview, grantCount}` (preview.ts:64-68) — there is no
 * capability set on it to diff, and the two obvious approximations are both
 * silently wrong. `buildSummary`'s blocked-list checks only `view:costs` of
 * the three `SensitiveFlag`s (preview.ts:159), and `navPreview` does not
 * represent flags at all, so a move flipping only `view:pay_rates` or
 * `view:employee_pii` would render "same areas" — telling the admin nothing
 * changed at the exact moment pay-rate visibility changed hands.
 *
 * It is also not folded INTO `buildRolePreview`'s return shape: that function
 * feeds the role editor's live preview, and widening it to serve a two-role
 * diff would couple two unrelated screens through one growing struct.
 */
import {
  AREA_DEFINITIONS,
  SENSITIVE_FLAGS,
  grantMap,
  type AreaKey,
  type AreaLevel,
  type SensitiveFlag,
} from './areas';
import { rowLevel } from './preview';

export interface RoleGrantSet {
  areas: ReadonlyArray<{ area_key: AreaKey; level: AreaLevel }>;
  flags: readonly SensitiveFlag[];
}

export interface AreaDeltaLine {
  /** The editor row's human label — `AreaDefinition.label`, never a raw key. */
  label: string;
  from: AreaLevel | null;
  to: AreaLevel | null;
}

export interface FlagDeltaLine {
  flag: SensitiveFlag;
  label: string;
}

export interface RoleDelta {
  gains: AreaDeltaLine[];
  loses: AreaDeltaLine[];
  flagGains: FlagDeltaLine[];
  flagLoses: FlagDeltaLine[];
  /** No area and no flag differs — the picker says so plainly. */
  isSame: boolean;
}

/** null < view < manage. */
function rank(level: AreaLevel | null): number {
  if (level === 'manage') return 2;
  if (level === 'view') return 1;
  return 0;
}

export function roleDelta(current: RoleGrantSet, candidate: RoleGrantSet): RoleDelta {
  const currentGrants = grantMap(current.areas);
  const candidateGrants = grantMap(candidate.areas);

  const gains: AreaDeltaLine[] = [];
  const loses: AreaDeltaLine[] = [];

  // Per UI row, not per area_key: `rowLevel` collapses the fourteen area keys
  // onto the ten rows the editor and RoleAreaChips already render, so the
  // delta names areas the way every other screen names them.
  for (const row of AREA_DEFINITIONS) {
    const from = rowLevel(row, currentGrants);
    const to = rowLevel(row, candidateGrants);
    if (rank(to) > rank(from)) gains.push({ label: row.label, from, to });
    else if (rank(to) < rank(from)) loses.push({ label: row.label, from, to });
  }

  // Driven by SENSITIVE_FLAGS rather than a literal list, so a fourth flag
  // added later cannot be silently omitted from the delta.
  const flagGains: FlagDeltaLine[] = [];
  const flagLoses: FlagDeltaLine[] = [];
  for (const { flag, name } of SENSITIVE_FLAGS) {
    const had = current.flags.includes(flag);
    const has = candidate.flags.includes(flag);
    if (!had && has) flagGains.push({ flag, label: name });
    else if (had && !has) flagLoses.push({ flag, label: name });
  }

  return {
    gains,
    loses,
    flagGains,
    flagLoses,
    isSame:
      gains.length === 0 &&
      loses.length === 0 &&
      flagGains.length === 0 &&
      flagLoses.length === 0,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npm run test -- roleDelta && npm run typecheck
```

Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add src/lib/permissions/roleDelta.ts src/lib/permissions/areas.ts src/components/roles/RoleEditor.tsx tests/unit/roleDelta.test.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): roleDelta — per-area and per-flag diff between two roles"
```

---

### Task 6: `useAssignRole`

**Files:**
- Create: `src/hooks/useAssignRole.ts`
- Test: `tests/unit/useAssignRole.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface AssignRoleParams {
    membershipId: string;
    role: string;        // a Role, or the CUSTOM_ROLE literal
    roleId?: string;     // required iff role === 'collaborator_custom'
  }
  export function useAssignRole(restaurantId: string | undefined):
    UseMutationResult<void, unknown, AssignRoleParams>;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/useAssignRole.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createElement } from 'react';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import { useAssignRole, assignRoleErrorMessage } from '@/hooks/useAssignRole';

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

describe('useAssignRole', () => {
  beforeEach(() => rpc.mockReset());

  it('calls the RPC with snake_case params and omits role_id for a builtin', async () => {
    rpc.mockResolvedValue({ error: null });
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'chef' });

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc).toHaveBeenCalledWith('assign_membership_role', {
      p_membership_id: 'm1',
      p_role: 'chef',
      p_role_id: null,
    });
  });

  it('passes role_id through for a custom role', async () => {
    rpc.mockResolvedValue({ error: null });
    const client = new QueryClient();
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'collaborator_custom', roleId: 'x1' });

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_role_id: 'x1' });
  });

  it('invalidates roles and restaurants on success', async () => {
    rpc.mockResolvedValue({ error: null });
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'chef' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['roles', 'r1']));
    expect(keys).toContain(JSON.stringify(['restaurants']));
    expect(keys).toContain(JSON.stringify(['collaborators', 'r1']));
  });

  it('rejects when PostgREST returns an error object', async () => {
    rpc.mockResolvedValue({ error: { code: '42501', message: 'Only an owner can change a role' } });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useAssignRole('r1'), { wrapper: wrapper(client) });

    result.current.mutate({ membershipId: 'm1', role: 'staff' });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('assignRoleErrorMessage', () => {
  it('surfaces the RPC sentence for a 42501, not a generic failure', () => {
    // PostgREST rejections arrive as plain {code, message, ...} objects, not
    // Error instances, so `instanceof Error` must be the LAST branch or every
    // denial renders as "Something went wrong".
    expect(assignRoleErrorMessage({ code: '42501', message: 'Only an owner can change an owner’s role' }))
      .toBe('Only an owner can change an owner’s role');
  });

  it('falls back for an Error instance', () => {
    expect(assignRoleErrorMessage(new Error('network down'))).toBe('network down');
  });

  it('falls back for something with no message at all', () => {
    expect(assignRoleErrorMessage(null)).toBe("Couldn't change that role. Please try again.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- useAssignRole
```

Expected: FAIL — cannot resolve `@/hooks/useAssignRole`.

- [ ] **Step 3: Implement**

Create `src/hooks/useAssignRole.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * useAssignRole — change an existing member's role.
 *
 * Wraps the assign_membership_role RPC rather than updating
 * user_restaurants directly. A direct UPDATE is the bug: the PERMISSIVE RLS
 * policy makes another member's row untargetable by a manager, so the update
 * matches zero rows and Postgres raises nothing — a success toast over a
 * no-op. The RPC raises 42501 on every denial instead.
 */
export interface AssignRoleParams {
  membershipId: string;
  /** A builtin role string, or the 'collaborator_custom' literal. */
  role: string;
  /** Required when `role` is 'collaborator_custom', forbidden otherwise. */
  roleId?: string;
}

const FALLBACK = "Couldn't change that role. Please try again.";

/**
 * The message to show for a failed assignment.
 *
 * PostgREST rejections arrive as plain `{code, message, details, hint}`
 * objects, NOT Error instances, so the `instanceof Error` branch must come
 * last — checking it first would send every 42501 denial to the generic
 * fallback and hide the sentence the RPC took care to write.
 */
export function assignRoleErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  if (error instanceof Error && error.message) return error.message;
  return FALLBACK;
}

export function useAssignRole(restaurantId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ membershipId, role, roleId }: AssignRoleParams) => {
      const { error } = await supabase.rpc('assign_membership_role', {
        p_membership_id: membershipId,
        p_role: role,
        p_role_id: roleId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // ['roles'] — member counts moved.
      queryClient.invalidateQueries({ queryKey: ['roles', restaurantId] });
      queryClient.invalidateQueries({ queryKey: ['collaborators', restaurantId] });
      // ['restaurants'] is not belt-and-braces: useRestaurants embeds the
      // signed-in user's own roleRecord, so a role change they can see must
      // refresh their resolved capabilities — the same reasoning useRoles.ts
      // documents at :15-19.
      queryClient.invalidateQueries({ queryKey: ['restaurants'] });
    },
  });
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run test -- useAssignRole && npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add src/hooks/useAssignRole.ts tests/unit/useAssignRole.test.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): useAssignRole mutation over the RPC"
```

---

### Task 7: The `RolePicker` component

The chip **is** the control. Clicking it opens a popover with search, grouped "Your custom roles" / "Built-in", each row showing name, description, area chips, and a checkmark on the current role.

**Files:**
- Create: `src/components/roles/RolePicker.tsx`
- Test: `tests/unit/RolePicker.test.tsx`

**Interfaces:**
- Consumes: `useRoles` (Task 1's `legacy_role`), `roleDelta` (Task 5), `useAssignRole` (Task 6), `RoleAreaChips`, `getInvitableRoles`/`canInviteCustomRole`/`CUSTOM_ROLE` from `invitations.ts`, `ROLE_METADATA`.
- Produces:
  ```typescript
  export interface RolePickerProps {
    membershipId: string;
    restaurantId: string;
    /** Display name of the person whose role this is — for the accessible name. */
    personName: string;
    /** The member's current role string. */
    currentRole: string;
    /** The member's current role_id, when they hold a custom role. */
    currentRoleId: string | null;
    /** The signed-in user's role in this restaurant — gates the option list. */
    callerRole: Role;
    disabled?: boolean;
  }
  export function RolePicker(props: RolePickerProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/RolePicker.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { RolePicker } from '@/components/roles/RolePicker';

const mockUseRoles = vi.fn();
vi.mock('@/hooks/useRoles', () => ({ useRoles: (...a: unknown[]) => mockUseRoles(...a) }));

const mutate = vi.fn();
vi.mock('@/hooks/useAssignRole', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useAssignRole')>('@/hooks/useAssignRole');
  return { ...actual, useAssignRole: () => ({ mutate, isPending: false }) };
});

const roleRow = (over: Record<string, unknown>) => ({
  id: 'x', restaurant_id: 'r1', name: 'Role', description: null,
  flavor: 'collaborator', builtin: false, legacy_role: null,
  created_at: '', role_areas: [], role_flags: [], memberCount: 0, ...over,
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

const base = {
  membershipId: 'm1', restaurantId: 'r1', personName: 'Dana Reyes',
  currentRole: 'staff', currentRoleId: null, callerRole: 'owner' as const,
};

describe('RolePicker', () => {
  beforeEach(() => { mockUseRoles.mockReset(); mutate.mockReset(); });

  it("the trigger's accessible name contains its visible text (WCAG 2.5.3)", () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });
    render(<RolePicker {...base} />, { wrapper });

    const trigger = screen.getByRole('button', { name: /Dana Reyes/i });
    const visible = trigger.textContent ?? '';
    expect(visible.trim().length).toBeGreaterThan(0);
    expect(trigger.getAttribute('aria-label')).toContain(visible.trim());
    expect(trigger.getAttribute('aria-label')).toContain('Change role');
  });

  it('shows a loading state while roles resolve', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: true, error: null });
    render(<RolePicker {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /Dana Reyes/i }));
    expect(screen.getByText(/loading roles/i)).toBeInTheDocument();
  });

  it('shows an error state distinctly from an empty one', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: new Error('boom') });
    render(<RolePicker {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /Dana Reyes/i }));
    // Not "no roles found" — a load failure must never read as emptiness.
    expect(screen.getByText(/couldn't load roles/i)).toBeInTheDocument();
    expect(screen.queryByText(/no roles found/i)).not.toBeInTheDocument();
  });

  it('hides owner from a manager and shows it to an owner', async () => {
    mockUseRoles.mockReturnValue({ roles: [], isLoading: false, error: null });

    const { unmount } = render(<RolePicker {...base} callerRole="manager" />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /Dana Reyes/i }));
    expect(screen.queryByRole('option', { name: /^Owner/ })).not.toBeInTheDocument();
    unmount();

    render(<RolePicker {...base} callerRole="owner" />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /Dana Reyes/i }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Owner/ })).toBeInTheDocument());
  });

  it('lists a custom role and assigns it with both role and roleId', async () => {
    mockUseRoles.mockReturnValue({
      roles: [roleRow({ id: 'c1', name: 'Operations Lead' })],
      isLoading: false, error: null,
    });
    render(<RolePicker {...base} />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /Dana Reyes/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Operations Lead/ }));
    await userEvent.click(screen.getByRole('button', { name: /change role to/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ membershipId: 'm1', role: 'collaborator_custom', roleId: 'c1' }),
      expect.anything()
    );
  });

  it('says so plainly when two roles grant the same thing', async () => {
    mockUseRoles.mockReturnValue({
      roles: [
        roleRow({ id: 'c1', name: 'Twin A', role_areas: [{ area_key: 'recipes', level: 'view' }] }),
        roleRow({ id: 'c2', name: 'Twin B', role_areas: [{ area_key: 'recipes', level: 'view' }] }),
      ],
      isLoading: false, error: null,
    });
    render(<RolePicker {...base} currentRole="collaborator_custom" currentRoleId="c1" />, { wrapper });
    await userEvent.click(screen.getByRole('button', { name: /Dana Reyes/i }));
    await userEvent.click(await screen.findByRole('option', { name: /Twin B/ }));
    expect(screen.getByText(/same access/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run test -- RolePicker
```

Expected: FAIL — cannot resolve `@/components/roles/RolePicker`.

- [ ] **Step 3: Implement**

Create `src/components/roles/RolePicker.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useInsideScrollLock } from '@/components/ui/scroll-lock-boundary';
import { Check, ChevronsUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { useRoles, type RoleWithGrants } from '@/hooks/useRoles';
import { useAssignRole, assignRoleErrorMessage } from '@/hooks/useAssignRole';
import { useToast } from '@/hooks/use-toast';
import { RoleAreaChips } from '@/components/roles/RoleAreaChips';
import { ROLE_METADATA } from '@/lib/permissions/definitions';
import {
  CUSTOM_ROLE,
  canInviteCustomRole,
  getInvitableRoles,
} from '@/lib/permissions/invitations';
import { roleDelta, type RoleGrantSet } from '@/lib/permissions/roleDelta';
import type { Role } from '@/lib/permissions/types';
import { cn } from '@/lib/utils';

export interface RolePickerProps {
  membershipId: string;
  restaurantId: string;
  /** Display name of the person whose role this is — for the accessible name. */
  personName: string;
  currentRole: string;
  currentRoleId: string | null;
  /** The signed-in user's role in this restaurant — gates the option list. */
  callerRole: Role;
  disabled?: boolean;
}

const grantSetOf = (role: RoleWithGrants | undefined): RoleGrantSet => ({
  areas: role?.role_areas ?? [],
  flags: (role?.role_flags ?? []).map((f) => f.flag),
});

export function RolePicker({
  membershipId,
  restaurantId,
  personName,
  currentRole,
  currentRoleId,
  callerRole,
  disabled = false,
}: RolePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const modal = useInsideScrollLock();
  const { toast } = useToast();

  // useRoles returns { roles, isLoading, error, ... } — NOT a raw React Query
  // result, so there is no `data` here.
  const { roles, isLoading, error } = useRoles(restaurantId);
  const assign = useAssignRole(restaurantId);

  const invitable = useMemo(() => getInvitableRoles(callerRole), [callerRole]);
  const mayAssignCustom = canInviteCustomRole(callerRole);

  const matches = (name: string) =>
    name.toLowerCase().includes(search.trim().toLowerCase());

  const customRoles = roles.filter(
    (r) => r.restaurant_id === restaurantId && matches(r.name)
  );
  const builtinRoles = roles.filter(
    (r) =>
      r.legacy_role !== null &&
      (invitable as readonly string[]).includes(r.legacy_role) &&
      matches(r.name)
  );

  const isCurrent = (r: RoleWithGrants) =>
    currentRoleId ? r.id === currentRoleId : r.legacy_role === currentRole;

  const currentRow = roles.find(isCurrent);
  const candidateRow = roles.find((r) => r.id === candidateId);
  const delta = candidateRow
    ? roleDelta(grantSetOf(currentRow), grantSetOf(candidateRow))
    : null;

  const currentLabel =
    currentRow?.name ?? ROLE_METADATA[currentRole as Role]?.label ?? currentRole;

  const commit = () => {
    if (!candidateRow) return;
    const isCustom = candidateRow.legacy_role === null;
    assign.mutate(
      {
        membershipId,
        role: isCustom ? CUSTOM_ROLE : candidateRow.legacy_role!,
        roleId: isCustom ? candidateRow.id : undefined,
      },
      {
        onSuccess: () => {
          toast({ title: `${personName} is now ${candidateRow.name}` });
          setOpen(false);
          setCandidateId(null);
          setSearch('');
        },
        onError: (err) =>
          toast({
            title: "Couldn't change that role",
            description: assignRoleErrorMessage(err),
            variant: 'destructive',
          }),
      }
    );
  };

  // The chip IS the control, so the visible text is the role name alone. WCAG
  // 2.5.3 Label in Name requires the accessible name to CONTAIN that visible
  // text, so a voice-control user saying "click Manager" still hits it —
  // hence the name is embedded rather than replaced.
  const triggerLabel = `${personName}: role is ${currentLabel}. Change role`;

  const renderRow = (r: RoleWithGrants) => (
    // value={r.name} is load-bearing: cmdk filters on the `value` prop, and
    // with chips and a description as children its default text extraction
    // would match the concatenated blob instead of the name.
    <CommandItem
      key={r.id}
      value={r.name}
      onSelect={() => setCandidateId(r.id)}
      className="flex flex-col items-start gap-1.5 py-2.5"
    >
      <div className="flex w-full items-center gap-2">
        <Check
          className={cn('h-4 w-4 shrink-0', isCurrent(r) ? 'opacity-100' : 'opacity-0')}
        />
        <span className="text-[14px] font-medium text-foreground">{r.name}</span>
      </div>
      {r.description && (
        <p className="pl-6 text-[13px] text-muted-foreground">{r.description}</p>
      )}
      <div className="pl-6">
        <RoleAreaChips areas={r.role_areas} />
      </div>
    </CommandItem>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setCandidateId(null);
          setSearch('');
        }
      }}
      modal={modal}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={triggerLabel}
          disabled={disabled}
          className="h-7 max-w-[220px] gap-1 rounded-full border-border/40 px-2.5 text-[13px] font-medium"
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[340px] p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search roles..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {/*
              These three states are direct children of CommandList, never
              routed through CommandEmpty. CommandEmpty means "no rows
              registered" — it cannot distinguish a load failure from an empty
              restaurant, and rendering an error through it would tell the
              admin there are no roles when in fact the request failed.

              !restaurantId is checked alongside isLoading because useRoles is
              enabled: !!restaurantId, and a disabled React Query reports
              isLoading === false.
            */}
            {(!restaurantId || isLoading) && (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                Loading roles…
              </p>
            )}
            {error && (
              <p className="px-3 py-6 text-center text-[13px] text-destructive">
                Couldn't load roles. Please try again.
              </p>
            )}
            {!isLoading && !error && customRoles.length === 0 && builtinRoles.length === 0 && (
              <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                No roles match. Create one in Team → Roles.
              </p>
            )}

            {/*
              The custom group renders for a caller who cannot assign custom
              roles too — visibly, with the reason. Hiding it is what produced
              the original "I made a role and it's nowhere" confusion.
            */}
            {customRoles.length > 0 && (
              <CommandGroup heading="Your custom roles">
                {mayAssignCustom ? (
                  customRoles.map(renderRow)
                ) : (
                  <p className="px-2 py-2 text-[13px] text-muted-foreground">
                    Only an owner or manager can assign a custom role.
                  </p>
                )}
              </CommandGroup>
            )}

            {builtinRoles.length > 0 && (
              <CommandGroup heading="Built-in">{builtinRoles.map(renderRow)}</CommandGroup>
            )}
          </CommandList>

          {delta && candidateRow && (
            <div className="space-y-2 border-t border-border/40 px-3 py-3">
              {delta.isSame ? (
                <p className="text-[13px] text-muted-foreground">
                  Same access — only the label changes.
                </p>
              ) : (
                <div className="space-y-1">
                  {[...delta.gains.map((g) => g.label), ...delta.flagGains.map((f) => f.label)].map(
                    (label) => (
                      <p key={`gain-${label}`} className="flex items-center gap-1.5 text-[13px] text-success">
                        <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Gains {label}
                      </p>
                    )
                  )}
                  {[...delta.loses.map((l) => l.label), ...delta.flagLoses.map((f) => f.label)].map(
                    (label) => (
                      <p key={`lose-${label}`} className="flex items-center gap-1.5 text-[13px] text-destructive">
                        <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Loses {label}
                      </p>
                    )
                  )}
                </div>
              )}
              <Button
                onClick={commit}
                disabled={assign.isPending}
                aria-label={`Change role to ${candidateRow.name}`}
                className="h-9 w-full rounded-lg bg-foreground text-[13px] font-medium text-background hover:bg-foreground/90"
              >
                {assign.isPending ? 'Changing…' : `Change role to ${candidateRow.name}`}
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

Add `text-success` to the Tailwind safelist only if the build tree-shakes it — `--success` and its Tailwind mapping already exist (`src/index.css:32-33`, `tailwind.config.ts:43-45`), so no new token is introduced.

- [ ] **Step 4: Run to verify it passes**

```bash
npm run test -- RolePicker && npm run typecheck && npm run lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add src/components/roles/RolePicker.tsx tests/unit/RolePicker.test.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): RolePicker — the role chip becomes the control"
```

---

### Task 8: Wire the picker into Team members and Collaborators

**Files:**
- Modify: `src/components/TeamMembers.tsx`
- Modify: `src/components/CollaboratorInvitations.tsx`

**Interfaces:**
- Consumes: `RolePicker` (Task 7).

- [ ] **Step 1: Replace the stack in `TeamMembers.tsx`**

Delete `updateMemberRole` (lines 112–134) entirely — the picker owns the write now, and this function is the silent-failure bug.

Delete `assignableRoles` (lines 62–64). It carries a second defect: `'owner'` is already the first entry of the owner matrix row (`invitations.ts:14`), so `[...getInvitableRoles('owner'), 'owner']` renders a duplicated menu entry with a colliding React key. `RolePicker` derives its own list from `getInvitableRoles`, correctly.

Replace lines 229–264 (the `Badge` + `Select` half of the dropdown) with:

```tsx
<RolePicker
  membershipId={member.id}
  restaurantId={restaurantId}
  personName={member.profiles?.full_name || member.profiles?.email || 'this member'}
  currentRole={member.role}
  currentRoleId={member.role_id ?? null}
  callerRole={userRole}
  disabled={!canManageMembers || isOwner || member.role === 'kiosk'}
/>
```

Keep the `DropdownMenu` for **Remove Member** only, and keep the mobile stacking wrapper at line 228 with its comment — `RolePicker` truncates, but the wrapper governs the whole action cluster.

Note the kiosk explainer at line 259 disappears with this edit. It was already unreachable: line 234 excluded kiosk rows from the dropdown entirely, so the branch could never render. `RolePicker` handles kiosk through `disabled` instead.

Add `role_id` to the `TeamMember` interface and to the `select` in `fetchTeamMembers`.

- [ ] **Step 2: Verify the Team page renders**

```bash
npm run typecheck && npm run lint && npm run test
```

Then verify in the browser: `preview_start` with the dev server, navigate to `/team`, and confirm the chip renders, opens, and shows both groups. Check `read_console_messages` for errors.

- [ ] **Step 3: Verify at 375×667**

`resize_window` to 375×812, reload `/team`, and confirm with a member whose role label is long (`Employee (self-service)`) that the row does not overflow horizontally and the name column has not collapsed. Screenshot for the record.

- [ ] **Step 4: Wire `CollaboratorInvitations.tsx`**

Render the same `RolePicker` on each accepted-collaborator row, passing `currentRole={collaborator.role}` and `currentRoleId={collaborator.roleId}`. Pending invitations keep their existing controls — an invitation is not a membership and `assign_membership_role` does not apply to it.

- [ ] **Step 5: Full check and commit**

```bash
npm run typecheck && npm run lint && npm run test
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add src/components/TeamMembers.tsx src/components/CollaboratorInvitations.tsx
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "feat(permissions): assign roles from the Team and Collaborators lists"
```

---

### Task 9: End-to-end proof

**Files:**
- Create: `tests/e2e/role-assignment.spec.ts`

- [ ] **Step 1: Write the test**

The RPC refuses self-targeting, so this test needs a second person. Sign the member up **first**, capture their auth id, then sign the owner up and seed the membership from the owner's own session — an owner may INSERT into `user_restaurants` for their restaurant under the existing PERMISSIVE policy, so no service-role key is involved.

```typescript
import { test, expect } from '@playwright/test';
import { generateTestUser, signUpAndCreateRestaurant, exposeSupabaseHelpers } from '../helpers/e2e-supabase';

test('an owner moves a member into a custom role and it survives a reload', async ({ page }) => {
  const member = generateTestUser('member');
  const owner = generateTestUser('owner');

  // 1. Sign the member up first, purely to mint a real auth.users row — the
  //    membership row's user_id is a foreign key, so it cannot be faked.
  await page.goto('/auth');
  await exposeSupabaseHelpers(page);
  await page.getByRole('tab', { name: /sign up/i }).click();
  await page.getByLabel(/email/i).first().fill(member.email);
  await page.getByLabel(/full name/i).fill(member.fullName);
  await page.getByLabel(/password/i).first().fill(member.password);
  await page.getByRole('button', { name: /sign up|create account/i }).click();
  await page.waitForURL('/', { timeout: 15000 });

  const memberUserId = await page.evaluate(async () => {
    const user = await (window as any).__getAuthUser();
    return user?.id as string;
  });
  expect(memberUserId).toBeTruthy();

  await page.evaluate(async () => { await (window as any).__supabase.auth.signOut(); });

  // 2. Owner signs up and creates the restaurant.
  await signUpAndCreateRestaurant(page, owner);
  await exposeSupabaseHelpers(page);

  // 3. Seed a custom role and the member's staff membership, from the owner's
  //    session. Both writes are ones the owner can legitimately make.
  const roleName = `Ops Lead ${Date.now()}`;
  await page.evaluate(
    async ({ memberUserId, roleName }) => {
      const supabase = (window as any).__supabase;
      const restaurantId = await (window as any).__getRestaurantId();

      const { data: role, error: roleError } = await supabase
        .from('roles')
        .insert({ restaurant_id: restaurantId, name: roleName, flavor: 'collaborator', builtin: false })
        .select('id')
        .single();
      if (roleError) throw new Error(`role insert failed: ${roleError.message}`);

      const { error: grantError } = await supabase
        .from('role_areas')
        .insert({ role_id: role.id, area_key: 'recipes', level: 'manage' });
      if (grantError) throw new Error(`grant insert failed: ${grantError.message}`);

      const { error: memberError } = await supabase
        .from('user_restaurants')
        .insert({ user_id: memberUserId, restaurant_id: restaurantId, role: 'staff' });
      if (memberError) throw new Error(`membership insert failed: ${memberError.message}`);
    },
    { memberUserId, roleName }
  );

  // 4. The actual behaviour under test.
  await page.goto('/team');

  const chip = page.getByRole('button', { name: new RegExp(`${member.fullName}.*Change role`) });
  await expect(chip).toBeVisible({ timeout: 10000 });
  await chip.click();

  await page.getByRole('option', { name: new RegExp(roleName) }).click();
  await page.getByRole('button', { name: `Change role to ${roleName}` }).click();

  await expect(
    page.getByRole('button', { name: new RegExp(`role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });

  // The reload is the whole point. The code this replaces showed a success
  // toast over a write that never landed; only a reload told the truth.
  await page.reload();
  await expect(
    page.getByRole('button', { name: new RegExp(`role is ${roleName}`) })
  ).toBeVisible({ timeout: 10000 });
});
```

If the membership INSERT is refused by RLS, do **not** reach for a service-role key — add an `__insertMembership` helper to `tests/helpers/e2e-supabase.ts` alongside the existing `__inviteCollaborator`, and report the policy that blocked it.

- [ ] **Step 2: Run it**

```bash
npx playwright test role-assignment --reporter=line
```

Bound this with the Bash tool's `timeout` parameter — never a hand-rolled poll loop (CLAUDE.md, No Unbounded Waits).

- [ ] **Step 3: Full suite and commit**

```bash
npm run typecheck && npm run lint && npm run test && npm run test:db
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment add tests/e2e/role-assignment.spec.ts
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/role-assignment commit -m "test(permissions): e2e proof that a custom-role assignment persists"
```

---

## Out of scope for this PR

Named so a reviewer does not read them as omissions. Both are separate PRs against this same design doc:

- **Move 2** — a role card's member count becomes a door (face pile → "Who's in this role" roster; Areas | People tabs in the role editor).
- **Move 3** — `EmployeeDialog`'s "App access" row, replacing the hardcoded `role: 'staff'` at `src/components/EmployeeDialog.tsx:412`.

Also out of scope: `copy_role_to_restaurants` still carries its default `PUBLIC` EXECUTE grant in production (spawned as its own task). It fails closed only incidentally, because its internal check keys off `auth.uid()`.
