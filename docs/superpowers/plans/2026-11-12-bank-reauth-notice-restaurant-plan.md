# Plan: Bank Reauth Notice Names the Restaurant and Links to It

Design: `docs/superpowers/specs/2026-11-12-bank-reauth-notice-restaurant-design.md`
Branch: `fix/bank-reauth-notice-restaurant`
Worktree: `.claude/worktrees/bank-reauth-notice-restaurant`

Use TDD for each task. Write the failing test first. Then write the code.
Commit after each task with explicit paths.

## Task 1: Database (design §5.1)

1. In `supabase/tests/bank_reauth_notices.sql`, change `plan(29)` to `plan(37)`.
   Add 2 `restaurant_name` checks and 6 grant checks (design §6).
2. Run `npm run test:db` and see the new checks fail.
3. Add `supabase/migrations/20261112180000_bank_reauth_cohort_restaurant_name.sql`.
   Copy both RPCs from `20260731020000_...`. Add `r.name AS restaurant_name`.
   Keep `STABLE`, `SECURITY DEFINER`, `search_path`, REVOKE, GRANT, and both
   comments.
4. Run `npm run db:reset` and `npm run test:db`. All checks pass.

## Task 2: Content builder (design §5.3)

1. In `tests/unit/bankReauthNoticeContent.test.ts`, add `restaurantId` to
   `BASE`. Add the cases in design §6.
2. In `supabase/functions/_shared/bankReauthNoticeContent.ts`:
   - Add `restaurantId` and `restaurantName` to `BankReauthNoticeInput`.
   - Add and export `cleanRestaurantName`.
   - Add the name prefix to the subject and the push title.
   - Add ` at <name>` after the bank label in the message.
   - Build one path `/banking?select_restaurant=<id>` for push and email.
3. Run `npx vitest run tests/unit/bankReauthNoticeContent.test.ts`.

## Task 3: Worker handler (design §5.2)

1. In `tests/unit/bankReauthNoticesHandler.test.ts`, add cases for cohort A
   and cohort B. Check that the email subject and the push URL carry the name
   and the id.
2. In `supabase/functions/_shared/bankReauthNoticesHandler.ts`, add
   `restaurant_name` to the row types, `restaurantName` to `NoticeTarget`, and
   pass both fields to the content builder.
3. Run the handler and content tests.

## Task 4: Link helpers (design §5.4)

1. Add `tests/unit/restaurantDeepLink.test.ts`.
2. Add `src/lib/restaurantDeepLink.ts` with `SELECT_RESTAURANT_PARAM`,
   `readLinkedRestaurantId`, `resolveLinkedRestaurant`, and
   `withoutLinkedRestaurant`.

## Task 5: Restaurant provider (design §5.4)

1. In `tests/unit/RestaurantContext.roleResolution.test.tsx`, wrap the
   `wrapper` in `MemoryRouter`. Add the linked-id race case.
2. Add `tests/unit/RestaurantContext.deepLink.test.tsx` with the cases in
   design §6, including the trade link case.
3. In `src/contexts/RestaurantContext.tsx`, read the key, put the linked
   restaurant first in the memo, and add the effect with a ref guard.
4. Run `npx vitest run tests/unit/RestaurantContext*`.

## Task 6: E2E (design §6)

1. Add `addSecondRestaurant` to `tests/helpers/e2e-supabase.ts`.
2. Add `tests/e2e/banking-restaurant-deep-link.spec.ts`.
3. Run `npx playwright test tests/e2e/banking-restaurant-deep-link.spec.ts --reporter=line`.

## Task 7: Checks

1. Run `npm run typecheck`, `npm run lint`, and `npm run test`.
2. Run `npm run build`.

## Deploy notes (for the PR body)

- Apply the migration before the `bank-reauth-notices` function deploys.
- No new secret. No new table. No RLS change.
