# Returning guests — implementation plan

Design: `docs/superpowers/specs/2026-11-12-returning-guests-design.md`.
Branch: `feature/returning-guests`. Each task uses TDD: write the failing test,
see it fail, write the code, see it pass, commit with explicit paths.

## Task 1 — RPC tests (pgTAP, red)

- File: `supabase/tests/returning_guest_trends.test.sql`.
- Write the 17 test groups in design section 5. Use `BEGIN; SELECT plan(N); ... ROLLBACK;`.
- Seed restaurants, `user_restaurants` rows (owner, staff, chef), and Toast,
  Revel, Focus and Square payments with dates relative to `CURRENT_DATE`.
- Run `npm run test:db`. Expect a failure: the function does not exist.

## Task 2 — RPC migration (green)

- File: `supabase/migrations/20261112180000_get_returning_guest_trends.sql`.
- Write the function as in design 4.1–4.6: guards, time zone fallback, one
  CTE per source, keys with `NULLIF(btrim(...),'')` and `||`, per-restaurant
  Toast first-6 rule, `first_seen`, weeks, summary, one `ROUND` at the end.
- Full-signature `REVOKE` and `GRANT`.
- Run `npm run db:reset` and `npm run test:db` until green.

## Task 3 — Area row (migration + TypeScript)

- File: `supabase/migrations/20261112180100_returning_guests_area.sql`. Insert
  the `returning_guests` row into `area_catalog` (design 4.7).
- `src/lib/permissions/areas.ts`: add `'returning_guests'` to `AreaKey`.
- `src/lib/permissions/areaData.ts`: add the row after `reviews`.
- Run `npx vitest run tests/unit/areas.test.ts tests/unit/routeAreas.test.ts`.
  Add the nav item in Task 6 in the same commit if the drift test needs both.

## Task 4 — Helpers (Vitest)

- Test first: `tests/unit/returningGuests.test.ts`.
- Code: `src/lib/returningGuests.ts` — types for the RPC result, `percentChange`,
  `parseCampaignStart`, `parseWeeks`, `noteForQuality`, `toChartRows`.

## Task 5 — Hook (Vitest)

- Test first: `tests/unit/useReturningGuestTrends.test.ts`.
- Code: `src/hooks/useReturningGuestTrends.ts` (design 4.8). Follow
  `src/hooks/useLaborSalesAnalytics.ts`.

## Task 6 — Nav and route

- `src/components/AppSidebar.nav.data.ts`: item after Reviews, icon `Repeat`.
- `src/components/AppSidebar.nav.ts`: hide the item for roles other than
  owner and manager. Test in `tests/unit/AppSidebar.nav.test.ts`.
- `src/App.tsx`: lazy import and the `/returning-guests` route.

## Task 7 — Components and page

- `src/components/returning-guests/ReturningGuestsSummary.tsx`.
- `src/components/returning-guests/ReturningGuestsChart.tsx`.
- `src/pages/ReturningGuests.tsx` with all page states (design 4.8).
- Run `npm run typecheck`, `npm run lint`, `npm run test`.

## Task 8 — Verify and ship (workflow phases 5–9)

- UI review in the browser: each page state, mobile width, dark mode.
- Code simplify, the Phase 7a reviewers, CodeRabbit.
- `npm run build`, full test run, PR, CI green, retrospective.

## Out of scope

- Square sync change for the card fingerprint (no Square card data in prod).
- Per-guest list. E2E test.
