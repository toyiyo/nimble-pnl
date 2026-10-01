# Stale pending outflows: 60-day runway rule and a daily cron — plan

Design: `docs/superpowers/specs/2026-09-30-stale-pending-outflows-design.md`

Rules for every task:

- Do not change `mark_stale_pending_outflows()`. Do not change RLS.
- Do not change the pending outflows page, the Expenses page or P&L readers.
- Do not run a prod write. The cron job does the first status change after
  the deploy.
- Write the test first. Run it and see it fail. Then write the code.
- Stage explicit paths. Commit after each task.

## Tasks

1. **Hook test (fails).** In `tests/unit/useLiquidityMetrics.test.tsx`:
   - Add `gte` to `createResolvingBuilder`. Keep the builder for
     `pending_outflows` in a variable so the test can read its calls.
   - Use `vi.useFakeTimers({ toFake: ['Date'] })` and
     `vi.setSystemTime(new Date(2026, 8, 30, 12))`. Restore real timers in
     `afterEach`.
   - Check `.gte('issue_date', '2026-08-02')` on the pending outflows
     builder. Add a year-edge case: now 2026-01-15 gives `'2025-11-17'`.
   - Check that `OPEN_OUTFLOW_WINDOW_DAYS` is 60.
   - Check `bookBalance` equals the balance minus the mocked rows.
   - Outcome case (design 5.1): balance 10,000, net burn 100 per day,
     in-window outflows 500. Expect `daysOfCash` 95 and `runwayStatus`
     `healthy`.

   Commit the failing test.

2. **Hook change.** In `src/hooks/useLiquidityMetrics.tsx` (design 3.2):
   - Export `OPEN_OUTFLOW_WINDOW_DAYS = 60`.
   - Compute `outflowCutoff` from `new Date()` inside the query function.
   - Add `.gte('issue_date', outflowCutoff)` after the status filter.

   Run the test file. All cases pass. Commit.

3. **pgTAP test (fails).** Write
   `supabase/tests/78_mark_stale_pending_outflows_cron.test.sql`, with
   `supabase/tests/76_bank_reauth_cron_dispatcher.test.sql` as the pattern:
   - The job `mark-stale-pending-outflows` exists, with schedule
     `15 6 * * *` and a command that contains
     `public.mark_stale_pending_outflows()`.
   - `has_function_privilege` is false for `anon` and `authenticated`, and
     true for `service_role`.
   - Fixture rows and the expected statuses in design 5.2. Use a test
     restaurant created in the test. Call the function, check each status,
     call it again and check that nothing changes.

   Check the number again with `ls supabase/tests`. Commit the failing test.

4. **Cron migration.** Run `ls supabase/migrations | tail -3`. Write
   `supabase/migrations/20260930120000_schedule_mark_stale_pending_outflows.sql`
   (design 3.3). Use a later timestamp if `20260930120000` is taken.
   - `DO` block with `cron.unschedule('mark-stale-pending-outflows')` in an
     `EXCEPTION WHEN OTHERS THEN NULL` handler.
   - `cron.schedule('mark-stale-pending-outflows', '15 6 * * *',
     'SELECT public.mark_stale_pending_outflows();')`.
   - `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated`.
   - `GRANT EXECUTE ... TO postgres, service_role`.

   Run `npm run db:reset`, then `npm run test:db`. The new test passes.
   Commit.

5. **Checks.** Run `npm run typecheck`, `npm run build`, `npm run test` and
   `npm run test:db`. Run `npx eslint` on the changed files only. Run
   `npx playwright test tests/e2e/dashboard-basis-labels.spec.ts
   --project=e2e --reporter=line`. Fix a failure that this branch causes.

## E2E

Justified exception (design 5.3). No markup changes. No seed helper exists
for connected banks and balances. The unit and pgTAP tests cover the logic.

## PR body notes

- State the prod effect (design 3.4): the first cron run changes `status`
  on 170 rows in 8 restaurants, table `pending_outflows`. No row is deleted.
  No amount changes.
- State that the runway numbers change on the dashboard, the Banking
  section and the Liquidity tab. No markup changes.
- State that the pending outflows page total still sums all open rows
  (design 6.7).
- List design section 7 as follow-ups.

## Not in this plan

- The Expenses page book balance (design 6.4).
- A runway note or a split total for old outflows (design 6.2, 6.7).
- Local-day edges for the hook.
