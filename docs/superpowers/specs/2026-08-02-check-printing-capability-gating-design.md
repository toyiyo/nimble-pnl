# Check-printing authorization: legacy-role gating → capability gating

**Date:** 2026-08-02
**Branch:** `claude/elastic-jang-ef80f3`
**Status:** Design — awaiting review

---

## 1. Problem

The check-printing feature predates the capability system and still authorizes on the legacy
`user_restaurants.role` string literal. Every other books surface moved to
`user_has_capability(...)` in `20260120100100_update_rls_for_collaborators.sql`; check printing
did not. PR #683 (roles-and-areas) then derived sidebar nav from area grants, calibrated against
each builtin's hand-written route list — so it *inherits* the mismatch rather than introducing it,
and extends its blast radius to custom roles.

### 1.1 The confirmed dead end

An Accountant (`collaborator_accountant`; builtin `b0000000-0000-0000-0000-000000000007`, granted
`books manage` at [20260730110000_seed_builtin_roles.sql:145](../../../supabase/migrations/20260730110000_seed_builtin_roles.sql)) reaches `/print-checks` by **both** paths:

- the hand-written allow-list, [src/App.tsx:176](../../../src/App.tsx)
- the area derivation, [src/lib/permissions/routeAreas.ts:71](../../../src/lib/permissions/routeAreas.ts)
  — `{ path: '/print-checks', area: 'books', minLevel: 'manage' }`

…and is then denied at the first write:

```sql
-- supabase/migrations/20260304120000_check_bank_accounts.sql:118-126
-- Authorization: caller must be owner/manager of this restaurant
IF NOT EXISTS (
  SELECT 1 FROM public.user_restaurants
  WHERE user_id = auth.uid()
    AND restaurant_id = v_restaurant_id
    AND role IN ('owner', 'manager')
) THEN
  RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
END IF;
```

Any **custom** role granted `books` at `manage` hits the same wall, and unlike the Accountant that
combination is user-constructed, so the number of affected principals is unbounded.

### 1.2 Full audit of the legacy-role surface in this feature

Item 2 of the task asks for an audit of the neighbouring policies. The gate is wider than the two
tables named — the same `role IN ('owner','manager')` literal appears in **five RPCs** and **six RLS
write policies**:

| # | Object | Kind | Newest definition |
|---|--------|------|-------------------|
| 1 | `claim_check_numbers_for_account` | RPC guard | [20260304120000:118-126](../../../supabase/migrations/20260304120000_check_bank_accounts.sql) |
| 2 | `set_check_bank_account_secrets` | RPC join-gate | [20260426120000:83](../../../supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql) |
| 3 | `get_check_bank_account_secrets` | RPC join-gate | [20260426120000:131](../../../supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql) |
| 4 | `update_check_bank_account_routing` | RPC join-gate | [20260426120000:175](../../../supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql) |
| 5 | `clear_check_bank_account_secrets` | RPC join-gate | [20260426120000:209](../../../supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql) |
| 6 | `check_settings` INSERT | RLS | [20260206000000:42-51](../../../supabase/migrations/20260206000000_check_printing.sql) |
| 7 | `check_settings` UPDATE | RLS | [20260206000000:53-69](../../../supabase/migrations/20260206000000_check_printing.sql) |
| 8 | `check_audit_log` INSERT | RLS | [20260206000000:169-178](../../../supabase/migrations/20260206000000_check_printing.sql) |
| 9 | `check_bank_accounts` INSERT | RLS | [20260304120000:47-56](../../../supabase/migrations/20260304120000_check_bank_accounts.sql) |
| 10 | `check_bank_accounts` UPDATE | RLS | [20260304120000:58-74](../../../supabase/migrations/20260304120000_check_bank_accounts.sql) |
| 11 | `check_bank_accounts` DELETE | RLS | [20260304120000:76-85](../../../supabase/migrations/20260304120000_check_bank_accounts.sql) |

**Provenance matters here.** Per the lesson *"CREATE OR REPLACE a function from the ORIGINAL
migration and you silently revert every PR that touched it since"*, note that RPCs 2–5 were
**rewritten** by `20260426120000_lock_check_bank_account_secrets.sql`; their bodies must be sourced
from **that** file, not from `20260425120100`. RPC 1 has exactly one definition repo-wide
(`grep -rlE "FUNCTION\s+(public\.)?claim_check_numbers_for_account\b" supabase/migrations` →
one hit), so no revert hazard.

### 1.3 A second, independent dead end

`PrintCheckButton` is rendered with **no permission gate at all** at
[src/components/pending-outflows/PendingOutflowCard.tsx:177](../../../src/components/pending-outflows/PendingOutflowCard.tsx),
which is reachable from `/expenses` — a `books@**view**` route
([routeAreas.ts:64](../../../src/lib/permissions/routeAreas.ts)). A custom role granted `books` at
`view` therefore sees a Print Check button that cannot possibly succeed, both before and after this
change (printing moves money, so it must stay at `manage`).

### 1.4 The SELECT policies are *wider* than the write path

Not legacy-role gating, but found by the audit and worth recording: all three tables' SELECT
policies grant **any member of the restaurant**, including `kiosk` and `staff`:

- `check_settings` SELECT — [20260206000000:32-40](../../../supabase/migrations/20260206000000_check_printing.sql)
- `check_audit_log` SELECT — [20260206000000:159-167](../../../supabase/migrations/20260206000000_check_printing.sql)
- `check_bank_accounts` SELECT — [20260304120000:37-45](../../../supabase/migrations/20260304120000_check_bank_accounts.sql)

That exposes the plaintext `routing_number` column and the full payee/amount check history to every
member. Handled in §4.

---

## 2. The capability choice (task item 1)

The task requires the capability be picked **deliberately**, with the reasoning recorded in the
migration header. This is the core design decision, so it gets the most space.

### 2.1 The option that looks attractive and is wrong: mint `edit:checks`

A dedicated capability reads well at the call site and looks like future-proofing. It is neither,
for three reasons:

**It would be a synonym, not a distinction.** Under the area model, a capability is not an
independent authorization axis — it is a *label on a bundle*. `user_has_capability` resolves
`role_id IS NOT NULL` members through a fixed capability→(area, level) map
([20260730140000_user_has_capability_from_areas.sql:234](../../../supabase/migrations/20260730140000_user_has_capability_from_areas.sql)
and neighbours). A new `edit:checks` mapped to `('books','manage')` would resolve **identically** to
the seven `edit:*` capabilities already in that bundle, for every role that can ever exist. Zero
behavioural difference, today and under any future custom role. The genuine lever for "checks get
their own authorization" is a new **area** or a **`role_flags`** entry — both change what existing
roles can do and need a product decision, not a refactor.

**It carries real risk on the most-rewritten object in the permission system.**
`user_has_capability` has been `CREATE OR REPLACE`d six times; `20260730140000` is the newest. A new
capability must be added to **both** the area map **and** the legacy role `CASE`, because the legacy
branch ends in `ELSE FALSE` (fail-closed) — add it to only the map and every `role_id IS NULL`
owner/manager silently loses check printing. A seventh 291-line rewrite for a no-op is a bad trade.

**It has a wide mirror-test blast radius.** `Capability` union in
[src/lib/permissions/types.ts](../../../src/lib/permissions/types.ts); `AREA_CAPABILITIES.books` in
[src/lib/permissions/areas.ts](../../../src/lib/permissions/areas.ts) (whose header states it is a
literal transcription of the SQL and must change with it); `ROLE_CAPABILITIES` for three roles in
[src/lib/permissions/definitions.ts](../../../src/lib/permissions/definitions.ts);
[tests/unit/areas.test.ts](../../../tests/unit/areas.test.ts); and
[supabase/tests/user_has_capability_areas_test.sql](../../../supabase/tests/user_has_capability_areas_test.sql),
whose whole purpose is a byte-identical round trip of ten builtins × the legacy capability set
against a hand-transcribed legacy fixture — a genuinely new capability either forces a second
sanctioned exception there or corrupts the fixture's meaning as a *transcription*.

### 2.2 Chosen: reuse two existing books-area capabilities, split by what the act *is*

Rather than one capability for the whole feature, the eleven objects split cleanly into two acts,
and each act already has a capability that names it:

| Act | Capability | Why |
|-----|-----------|-----|
| **Issuing a check** — claim a number, write the audit row | `edit:pending_outflows` | The persisted artifact of printing a check **is** a pending outflow. `pending_outflows.check_bank_account_id` was added by this very feature ([20260304120000:149-152](../../../supabase/migrations/20260304120000_check_bank_accounts.sql)); [PrintChecks.tsx](../../../src/pages/PrintChecks.tsx) calls `createPendingOutflow` for each check; `PrintCheckButton` lives **on** the pending-outflow card. Claiming the number and logging the audit row are subordinate steps of that one money-moving act. |
| **Configuring the instrument** — check settings, bank accounts, MICR secrets | `edit:banking` | A check bank account *is* banking configuration: `check_bank_accounts.connected_bank_id` FKs to `connected_banks` ([20260304120000:13](../../../supabase/migrations/20260304120000_check_bank_accounts.sql)), and the secrets RPCs handle routing + account numbers. `view:banking` already gates `connected_banks` SELECT ([20260120100100:460](../../../supabase/migrations/20260120100100_update_rls_for_collaborators.sql)). |

Both capabilities already resolve exactly as needed, with **no change to `user_has_capability`**:

- legacy `CASE` — `edit:banking` → `('owner','manager','collaborator_accountant')`
  ([20260730140000:110](../../../supabase/migrations/20260730140000_user_has_capability_from_areas.sql));
  `edit:pending_outflows` likewise.
- area map — both → `('books','manage')`
  ([20260730140000:234](../../../supabase/migrations/20260730140000_user_has_capability_from_areas.sql) and neighbour).

Which means the RPC gate becomes **`books@manage`**, matching
[routeAreas.ts:71](../../../src/lib/permissions/routeAreas.ts) exactly — route and RPC agree *by
construction*, which is task item 4.

### 2.3 This is a fix, not a weakening

The task forbids weakening the guard. Check the direction of travel:

- Today the RPC says `owner/manager`, while the `pending_outflows` INSERT that the **same click**
  performs says `edit:pending_outflows`
  ([20260120100100:202](../../../supabase/migrations/20260120100100_update_rls_for_collaborators.sql)).
  **The two halves of one atomic act disagree.** That disagreement is the bug.
- The set actually widens by exactly one legacy role — `collaborator_accountant` — which is a role
  whose entire purpose is bookkeeping and which **already** holds `edit:pending_outflows`,
  `edit:banking`, `edit:transactions`, and `edit:expenses`. It can already record that money left the
  account; it simply cannot print the instrument.
- For `role_id IS NOT NULL` members the gate becomes `books@manage`, which is *the same tier* the
  route derivation already treats as the bar for writing a check ("Writing a check moves money — the
  only books path gated at manage", [routeAreas.ts:70](../../../src/lib/permissions/routeAreas.ts)).

So the alternative disposition the task offers — *remove `/print-checks` from the Accountant's route
list instead* — is **rejected**, and explicitly: an Accountant that can create, categorise and settle
a pending outflow but cannot print the check for it is an arbitrary seam, and it would still leave
every custom `books@manage` role locked out of a page the derivation grants them.

### 2.4 One deliberate exception: `get_check_bank_account_secrets` stays at manage tier

It is a *read*, so `view:banking` (books@**view**) would be the mechanical choice. It is instead
gated on `edit:banking` (books@**manage**), because it decrypts and returns a **full bank account
number** — the single most sensitive read in the feature. Its only two call sites are the print path
([PrintChecks.tsx:177](../../../src/pages/PrintChecks.tsx), [:264](../../../src/pages/PrintChecks.tsx))
and the settings dialog, both `manage` surfaces, so the manage tier costs nothing and preserves
today's narrowness for custom roles.

This is also a **hard dependency, not a nicety**: when the account has `print_bank_info` on,
`PrintChecks` aborts with a toast if `fetchAccountSecrets` throws
([PrintChecks.tsx:176-185](../../../src/pages/PrintChecks.tsx)). Converting RPC 1 without RPC 3 would
turn the dead end into a *different* dead end one step later.

---

## 3. Design

### 3.1 Final mapping

| Object | Before | After |
|--------|--------|-------|
| `claim_check_numbers_for_account` | `role IN ('owner','manager')` | `user_has_capability(v_restaurant_id, 'edit:pending_outflows')` |
| `check_audit_log` INSERT | `role IN ('owner','manager')` | `user_has_capability(restaurant_id, 'edit:pending_outflows')` |
| `check_settings` INSERT / UPDATE | `role IN ('owner','manager')` | `user_has_capability(restaurant_id, 'edit:banking')` |
| `check_bank_accounts` INSERT / UPDATE / DELETE | `role IN ('owner','manager')` | `user_has_capability(restaurant_id, 'edit:banking')` |
| `set_ / update_ / clear_check_bank_account_secrets` | join on `ur.role IN (...)` | `user_has_capability(cba.restaurant_id, 'edit:banking')` |
| `get_check_bank_account_secrets` | join on `ur.role IN (...)` | `user_has_capability(cba.restaurant_id, 'edit:banking')` — see §2.4 |
| `check_settings` SELECT | any member | `user_has_capability(restaurant_id, 'view:banking')` |
| `check_bank_accounts` SELECT | any member | `user_has_capability(restaurant_id, 'view:banking')` |
| `check_audit_log` SELECT | any member | `user_has_capability(restaurant_id, 'view:pending_outflows')` |

`check_audit_log` keeps having **no UPDATE/DELETE policy** — audit rows stay immutable
([20260206000000:180](../../../supabase/migrations/20260206000000_check_printing.sql)).

### 3.2 Shape of the RPC guard

For RPC 1 the guard replaces the `NOT EXISTS` block in place, preserving the surrounding body
verbatim (validation → account lookup → **guard** → atomic `UPDATE ... RETURNING` → null check):

```sql
-- Authorization: capability-gated, not role-gated. See migration header.
IF NOT public.user_has_capability(v_restaurant_id, 'edit:pending_outflows') THEN
  RAISE EXCEPTION 'Unauthorized: insufficient permissions for this restaurant';
END IF;
```

The exception message is unchanged so existing assertions and the UI toast keep working.
`user_has_capability` is `STABLE SECURITY DEFINER SET search_path = public`, so it is safe to call
from inside another `SECURITY DEFINER` function whose own `search_path` is `public, pg_temp`.

For RPCs 2–5 the `AND ur.role IN ('owner','manager')` join predicate is replaced by a
`user_has_capability(cba.restaurant_id, 'edit:banking')` predicate; where that removes the only
reason the `user_restaurants` join existed, the join is dropped rather than left dangling.

### 3.3 Migration

`supabase/migrations/20260802120000_check_printing_capability_gating.sql` — prefix verified unique
against both the worktree and `origin/main` (`git ls-tree --name-only origin/main
supabase/migrations/ | grep -c 202608` → `0`), per the repeated lessons on colliding version
prefixes.

Header records: the capability choice and the §2.1/§2.2 reasoning in condensed form; the provenance
of each replaced body (which migration it was copied from); and the §2.4 exception.

Each RPC is re-emitted with its **full newest body** copied from its newest definition — RPC 1 from
`20260304120000`, RPCs 2–5 from `20260426120000` — with only the guard changed. Each policy is
`DROP POLICY IF EXISTS` then `CREATE POLICY`, following the house style of
`20260120100100_update_rls_for_collaborators.sql`.

### 3.4 UI: gate `PrintCheckButton` (§1.3)

Wrap the render site at
[PendingOutflowCard.tsx:177](../../../src/components/pending-outflows/PendingOutflowCard.tsx) in the
codebase's existing capability check for `edit:pending_outflows`, so a `books@view` role no longer
sees a control that must fail. This closes the second dead end and keeps the UI honest about the
`manage` bar the route derivation and the RPC now both enforce. (Exact hook/component to match
whatever `PendingOutflowCard` and its siblings already use — no new gating primitive.)

---

## 4. Scope decisions, stated explicitly

**Included, though technically beyond "legacy-role gating":** the three SELECT policies (§1.4). The
audit was asked for; leaving a `kiosk` able to read `routing_number` and the whole check register
after a PR titled "capability gating for check printing" would be worse than the narrowing. All
consumers are books surfaces — `grep -rln "useCheckSettings\|useCheckBankAccounts\|useCheckAuditLog"
src/` returns exactly `CheckSettingsDialog.tsx`, `PrintCheckButton.tsx`, `PrintChecks.tsx` and the
three hooks themselves, and no edge function or other module touches the tables directly — so
`books@view` is sufficient for every real reader. This is a **narrowing**; it is called out here so
review can veto it independently of the rest.

**Excluded:** any change to `user_has_capability`, the area catalog, the builtin seeds, the
`Capability` union, or `ROLE_CAPABILITIES`. §2.2 is chosen precisely so none is needed.

**Excluded:** the `_guard_check_bank_account_secrets` trigger and its
`app.allow_check_account_secrets_write` one-shot bypass
([20260426120000:27-34](../../../supabase/migrations/20260426120000_lock_check_bank_account_secrets.sql)).
It is a column-write guard, not a role gate, and is orthogonal.

---

## 5. Testing (task item 3)

New file `supabase/tests/25_check_printing_capabilities.sql`, pgTAP, `SELECT plan(N)`.

### 5.1 Denied baseline first

Per the lesson *"Exercise an RLS clause with an entity that ONLY that clause grants"*, every
assertion starts from a **denied** principal and flips exactly one attribute:

1. A member with **no** `books` area (e.g. a custom role granted `inventory manage` only) →
   `throws_ok` on `claim_check_numbers_for_account` with the exact
   `'Unauthorized: insufficient permissions for this restaurant'` message.
2. The **same** member re-granted `books` at `**view**` → still throws. (Proves the bar is `manage`,
   not merely "has books".)
3. The same member re-granted `books` at `**manage**` → `lives_ok` **and** `is(...)` the returned
   start number, plus `is(...)` that `next_check_number` advanced by the claimed count.
4. Legacy `role_id IS NULL` rows: `owner` and `manager` still succeed (no regression through the
   legacy `CASE` branch); `staff` still throws.
5. `collaborator_accountant` — the principal the whole task exists for — succeeds.

### 5.2 The test must fail against the pre-change function

Assertion 5 is the one that does this: `collaborator_accountant` is denied by the current
`role IN ('owner','manager')` guard and permitted by the new one. Assertion 3 (custom
`books@manage`) does it too. **Verified by construction, then verified for real**: the plan runs the
new test file against `origin/main`'s migration set *before* applying the new migration and confirms
it red, then again after and confirms it green. Per the lesson *"Editing a migration then running
`test:db` (no reset) tests the OLD migration state"*, both runs are preceded by `npm run db:reset`.

### 5.3 RLS coverage

For each converted policy, the same denied-baseline shape under `SET LOCAL role TO authenticated`
(RLS is only enforced for non-superusers): a `books@view` custom role can `SELECT` from all three
tables but its `INSERT` into `check_audit_log` / `check_settings` / `check_bank_accounts` returns
zero rows or raises; at `books@manage` it succeeds. A member with no books area cannot `SELECT`.

### 5.4 Existing tests

[supabase/tests/24_check_printing.sql](../../../supabase/tests/24_check_printing.sql) (`plan(55)`)
has **no** coverage of RPC 1's authorization branch, so nothing there goes vacuous. Per the lesson
*"Adding an auth.uid() guard turns every existing pgTAP test of that RPC vacuous"*, the plan still
runs `grep -rln` for every touched object name across `supabase/tests/` and re-reads each hit,
treating every negative assertion as suspect — the audit-log CHECK-constraint block in file 24
disables RLS temporarily and must be re-verified against the new policies.

### 5.5 Task item 4 — route/RPC agreement

A TypeScript unit test asserting the invariant directly rather than by inspection: for each of the
ten builtins plus a synthetic custom role granted `books@manage` and one granted `books@view`,
`/print-checks ∈ allowedPathsForAreas(areas)` **iff** the role satisfies `books@manage`. Paired with
a SQL assertion that `user_has_capability(..., 'edit:pending_outflows')` is true for exactly the same
set — the two ends of the same invariant, checked independently.

---

## 6. Risks

| Risk | Mitigation |
|------|-----------|
| Re-emitting RPCs 2–5 from the wrong ancestor silently reverts `20260426120000` | Bodies copied from `20260426120000` explicitly; provenance recorded per-function in the migration header; post-apply `\sf` diff of each function against expectation. |
| SELECT narrowing (§4) breaks an unknown consumer | Consumer sweep done (§4) and recorded; flagged for independent veto in review. |
| `user_has_capability` called inside a `SECURITY DEFINER` RPC evaluates as the *definer* rather than the caller | It resolves on `auth.uid()`, which is a request-scoped GUC unaffected by `SECURITY DEFINER`; assertion 4 (legacy `staff` still throws) is the regression detector. |
| Migration prefix collides with a PR merging first | Verified against `origin/main` at design time; re-verified immediately before opening the PR. |

---

## 7. Open questions for review

1. **SELECT narrowing (§4)** — in or out? It is the only part of this change that removes access
   from anyone.
2. **`get_check_bank_account_secrets` at `edit:banking` rather than `view:banking` (§2.4)** —
   deliberate asymmetry; confirm it reads as principled rather than inconsistent.
3. **`edit:banking` vs `edit:pending_outflows` split (§2.2)** — is two capabilities across eleven
   objects clearer than one, given both resolve identically today?
