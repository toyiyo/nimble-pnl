# Plan: shift-trade approval from the scheduling area grant

Date: 2026-08-20
Branch: `fix/trade-approval-area-grant`
Design: docs/superpowers/specs/2026-08-20-trade-approval-area-grant-design.md
Worktree: .claude/worktrees/trade-approval-area-grant

Each step lists its tests first. Write the test, see it fail, write the
code, see it pass, commit.

## Step 1: Migration

File: `supabase/migrations/<fresh-14-digit-timestamp>_trade_approval_area_grant.sql`.
Check that the timestamp prefix is unique repo-wide before you commit.

1. Write a provenance header. Name the source migration for each object:
   - `approve_shift_trade`, `reject_shift_trade` from
     `20260713010000_harden_accept_shift_trade.sql`.
   - `create_shift_trade_for_employee` from
     `20260814130000_allow_draft_shift_trade.sql`.
   - The three policies from `20260104120000_create_shift_trades.sql`
     and `20260105000000_fix_shift_trades_rls.sql`.
2. Re-create `approve_shift_trade` and `reject_shift_trade` from the
   latest bodies. Change only the guard condition to:
   `IF NOT user_has_capability((SELECT restaurant_id FROM shift_trades WHERE id = p_trade_id), 'edit:scheduling') THEN`
   with error `Unauthorized: schedule manage access required`.
   Warning: keep the guard BEFORE the `FOR UPDATE` fetch. The order
   prevents a trade-ID existence oracle (see the design doc).
   Keep `SECURITY DEFINER`, `SET search_path = public, pg_temp`, the
   `p_manager_user_id != auth.uid()` check, the GRANT statements, and
   the COMMENT statements (update the comment text).
3. Re-create `create_shift_trade_for_employee` from the latest body.
   Same guard swap with `p_restaurant_id` as the helper argument. Write
   a function comment that states: the guard mirrors the approve
   audience; both move to `edit:scheduling` in this migration, so the
   old "dead-end approval queue" rationale no longer applies.
4. Drop and re-create the three policies with the SAME names:
   - `"Managers can view all shift trades"` (SELECT)
   - `"Managers can approve or reject trades"` (UPDATE, keep
     `WITH CHECK (true)`)
   - `"Managers can delete shift trades"` (DELETE)
   Each with
   `USING (user_has_capability(shift_trades.restaurant_id, 'edit:scheduling'))`.

## Step 2: pgTAP tests

New file `supabase/tests/<next-NN>_trade_approval_area_grant.test.sql`.
Follow the BEGIN / plan(N) / finish() / ROLLBACK pattern. Non-vacuous
subjects: each subject satisfies ONLY the clause under test.

Tests:
1. A member with `role = 'collaborator_custom'` and a custom role with
   `role_areas('scheduling','manage')`: `approve_shift_trade` returns
   `success = true`; `reject_shift_trade` returns `success = true` (on a
   second trade); SELECT sees all restaurant trades; DELETE removes a
   trade.
2. The same shape at level `view`: both RPCs return
   `Unauthorized: schedule manage access required`; SELECT sees zero
   non-participant trades; DELETE removes zero rows.
3. A legacy `operations_manager` with no `role_id`: approve succeeds.
4. A caller with no membership row: approve and reject fail closed with
   the generic error, for a real trade ID and for a random ID.

Impersonate with `set_config('request.jwt.claims', ...)`. Add
`SET LOCAL role = 'authenticated'` only for the RLS assertions. `RESET
ROLE` before `finish()`.

Change the existing suite `supabase/tests/53_directed_shift_trade_rls.sql`:
- Test 6 (line ~180): change `0::bigint` to `1::bigint`.
- Change the test comment and the header comment (lines 6-7): the
  SELECT policy now admits every holder of `edit:scheduling`, dated
  2026-08-20.

Run: `npm run db:reset` then `npm run test:db`. All suites must pass.

## Step 3: Frontend gate

File: `src/pages/Scheduling.tsx`.

1. Unit test first (`tests/unit/scheduling-trades-gate.test.tsx` or
   similar): with `edit:scheduling` resolved, the trades tab shows; with
   only `view:scheduling`, it does not; while unresolved, it does not.
2. Import `usePermissions`. Compute
   `const canManageSchedule = isResolved && hasCapability('edit:scheduling')`.
3. Wrap the trades `TabsTrigger` (line ~906) and the trades
   `TabsContent` (line ~1632) in `{canManageSchedule && (...)}`.
4. Convert the `Tabs` at line ~881 to controlled state. Reset to
   `'schedule'` when the active tab is `'trades'` and
   `canManageSchedule` is false. Copy the pattern from
   `src/pages/RestaurantSettings.tsx:420-438`.
5. Run `npm run typecheck`, `npm run lint`, `npm run test`.

## Step 4: E2E

Extend `tests/e2e/manager-initiated-shift-trade.spec.ts` or add
`tests/e2e/custom-role-trade-approval.spec.ts`:
- Create a custom role with `scheduling@manage` (pattern:
  `tests/e2e/roles-and-areas.spec.ts`).
- Sign in as that member. Open the schedule page. The trades tab shows.
- Approve a pending trade. The trade status changes to approved.
- Negative check: a member with `scheduling@view` does not see the
  trades tab.

## Step 5: Verify

- `npm run typecheck && npm run lint && npm run test`
- `npm run db:reset && npm run test:db`
- E2E for the touched specs.

## Step 6: PR

Title: `fix(scheduling): allow trade approval from the scheduling area grant`.
Body: problem (Eden's error), the audience table from the design doc,
the change list, the test evidence, and the out-of-scope note for
open-shift claims.

## Out of scope

- `approve_open_shift_claim` / `reject_open_shift_claim` keep their
  legacy guard. File a follow-up task after the PR.
- `cancel_shift_trade` does not change.
