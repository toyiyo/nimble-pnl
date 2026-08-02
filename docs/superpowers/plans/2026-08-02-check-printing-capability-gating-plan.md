# Plan — check-printing capability gating

**Design:** [2026-08-02-check-printing-capability-gating-design.md](../specs/2026-08-02-check-printing-capability-gating-design.md)
(revised after Phase 2.5; supabase review 0 critical/0 major, frontend review 1 critical folded in)
**Branch:** `claude/elastic-jang-ef80f3`

---

## Task 1 — RED test first

**File:** `supabase/tests/25_check_printing_capabilities.sql` (new)

Modelled on [collaborator_custom_rls_test.sql](../../../supabase/tests/collaborator_custom_rls_test.sql):
denied-baseline-first throughout, custom roles built from `roles` + `role_areas`, impersonation via
`set_config('role','authenticated',true)` + `request.jwt.claims`, `RESET ROLE` before `finish()`.

Fixtures — one restaurant, one `check_bank_accounts` row, and five principals:

| # | Principal | Expectation on `claim_check_numbers_for_account` |
|---|-----------|--------------------------------------------------|
| A | custom role, `inventory manage` only (no books) | throws `'Unauthorized: insufficient permissions for this restaurant'` |
| B | custom role, `books **view**` | throws — proves the bar is `manage`, not "has books" |
| C | custom role, `books **manage**` | `lives_ok` + `is()` the start number + `is()` that `next_check_number` advanced by the count |
| D | legacy `role_id IS NULL`: `owner`, then `manager` | succeed (legacy `CASE` branch, no regression) |
| E | legacy `role_id IS NULL`: `staff` | throws — the detector for `user_has_capability` misresolving inside `SECURITY DEFINER` |
| F | legacy `role_id IS NULL`: `collaborator_accountant` | succeeds — **the assertion this whole task exists for** |

RLS coverage (§5.3), under `SET LOCAL role TO authenticated`, for each converted policy:
principal B (`books@view`) can `SELECT` from all three tables but every write is denied; principal C
(`books@manage`) writes succeed; principal A cannot `SELECT` at all. Principal B's read-succeeds /
write-denied pair *is* the §5.5 tier-ordering invariant — it pins `SELECT tier ≤ route tier`.

Also assert `check_audit_log` still has no UPDATE/DELETE policy (immutability preserved).

**Gate:** run `npm run db:reset && npm run test:db` **before** Task 2 exists. Confirm the file is
RED, and specifically that assertions **C** and **F** are the failing ones — not merely that
something failed. Record the observed failure output in `progress.md`. Per the lesson *"editing a
migration then running `test:db` without a reset tests the OLD migration state"*, every `test:db`
run in this plan is preceded by `db:reset`.

## Task 2 — the migration

**File:** `supabase/migrations/20260802120000_check_printing_capability_gating.sql` (new)

Re-verify prefix uniqueness against `origin/main` immediately before writing (`git ls-tree
--name-only origin/main supabase/migrations/ | grep -c 202608`).

**Header** records, per the task's explicit requirement: the capability choice and why
(`edit:pending_outflows` for issuing, `edit:banking` for configuring); why a dedicated `edit:checks`
was rejected; the §2.4 exception for `get_check_bank_account_secrets`; the provenance of each
re-emitted body; and the consumer-sweep grep that justifies the SELECT narrowing.

1. **RPC 1** `claim_check_numbers_for_account` — body copied verbatim from
   [20260304120000](../../../supabase/migrations/20260304120000_check_bank_accounts.sql) (its only
   definition repo-wide), guard swapped to
   `IF NOT public.user_has_capability(v_restaurant_id, 'edit:pending_outflows') THEN`. Exception
   message unchanged.
2. **RPCs 2–5** `set_` / `get_` / `update_check_bank_account_routing` / `clear_` — bodies copied
   verbatim from
   [20260426120000](../../../supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql)
   (**not** `20260425120100`), `AND ur.role IN (...)` replaced by
   `public.user_has_capability(cba.restaurant_id, 'edit:banking')`, `user_restaurants` join dropped
   where it then has no purpose. Comment records why that is multiplicity-safe (`UNIQUE(user_id,
   restaurant_id)` + PK-filtered driving table) and that the single-query anti-enumeration property
   is preserved.
3. **Nine policies**, `DROP POLICY IF EXISTS` + `CREATE POLICY` per house style, to the §3.1 mapping.
   No UPDATE/DELETE policy added to `check_audit_log`.

**Gate:** `npm run db:reset && npm run test:db` → the new file GREEN, `24_check_printing.sql` still
GREEN. Then `\sf` each of the five functions and diff against expectation, confirming no accidental
revert of `20260426120000`.

## Task 3 — vacuous-test sweep

Per the lesson *"adding a guard turns every existing pgTAP test of that RPC vacuous"*:
`grep -rln` each of the five function names and three table names across `supabase/tests/`, re-read
every hit, and treat every negative assertion as suspect. Known hit:
[24_check_printing.sql](../../../supabase/tests/24_check_printing.sql) disables RLS temporarily for
its audit-log CHECK-constraint block — re-verify it against the new policies. Design §5.4 expects no
vacuity (file 24 has no coverage of RPC 1's authz branch), but this is verified, not assumed.

## Task 4 — frontend gate

**File:** `src/components/pending-outflows/PendingOutflowCard.tsx` (~line 177)

Wrap the whole `<PrintCheckButton …/>` element in
`isResolved && hasCapability('edit:pending_outflows')` from `usePermissions()`. Per design §3.4:
render-site placement (not an early return inside the component, which would still mount the dialog
and three hooks), hidden rather than disabled, `isResolved` included so "not yet known" is not
treated as "denied". Import order per CLAUDE.md; no new gating primitive.

## Task 5 — route/capability agreement test

**File:** `tests/unit/routeAreas.test.ts` (extend) or a sibling.

For each of the ten builtins plus a synthetic `books@manage` role and a synthetic `books@view` role:
`/print-checks ∈ allowedPathsForAreas(areas)` **iff** the role satisfies `books@manage`. This is task
item 4's frontend half; its SQL half is principal C/B in Task 1.

## Task 6 — verify

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run db:reset && npm run test:db`. Each in
the foreground under the Bash tool's own `timeout` — no hand-rolled poll loops, no `ps aux | grep -c`
(CLAUDE.md "No Unbounded Waits"). E2E only if a check-printing spec exists.

## Task 7 — ship

`code-simplify` → Phase 7a multi-model review → CodeRabbit → PR → CI green → comment triage.
`progress.md` stays uncommitted (it is in `.gitignore:43`).

---

## Order and rationale

1 → 2 is the RED→GREEN gate and must not be reordered. 3 must follow 2 (it inspects post-migration
behaviour). 4 and 5 are independent of 1–3 and of each other. 6 gates 7.

## Rollback

Every change is additive-by-replacement in one migration; reverting the single migration file and
the two source files restores prior behaviour exactly. No data migration, no destructive DDL.

## Open item carried from design §7

The §4 SELECT narrowing is the only access-removing part of this change. Default **in**. If it comes
out, drop the three SELECT policies from Task 2 step 3 and principal A's/B's SELECT assertions from
Task 1 — nothing else changes.
