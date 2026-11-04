# POS sale dates plan

Design: `docs/superpowers/specs/2026-11-03-pos-sale-date-utc-design.md`

Do each task with TDD. Run the tasks in this order.

## Task 1: Add the sale defaults helper

- Write failing tests in `tests/unit/saleDateDefaults.test.ts`. Pin `now` with `Date.UTC`.
- Add `getSaleDateTimeDefaults` to `src/lib/timezone.ts`.

## Task 2: Use the restaurant clock in the dialog

- Write a failing test in `tests/unit/POSSaleDialog.defaultDate.test.tsx`.
- Add the `timezone` prop. Compute the blank form in one local function.
- Run the reset effect on open, with deps `[editingSale, form, open, timezone]`.
- Add a test: the dialog opens on a later day and shows the new default.
- Pass `safeTz(selectedRestaurant.restaurant?.timezone)` from `src/pages/POSSales.tsx`.
- Add the prop to the four existing `POSSaleDialog` unit test files.

## Task 3: Keep the stated day in the CSV path

- Write failing tests in `tests/unit/importedSaleDate.test.ts`. Run them under
  `TZ=America/Chicago` and `TZ=Pacific/Auckland`.
- Add `toImportedSaleDate` to `src/lib/timezone.ts`.
- Add tests for impossible days: `2026-13-45` and `2026-02-31` both give `''`.
- Use it at `src/components/POSSalesFileUpload.tsx:132-138`.
- Use `toDateOnlyString` at `src/components/POSSalesFileUpload.tsx:349`.

## Task 4: Run the E2E spec after 18:00 CST

- Run `tests/e2e/manual-sale-tip-not-doubled.spec.ts` with the system clock
  after 18:00 CST, or with a Playwright clock that gives this state.
