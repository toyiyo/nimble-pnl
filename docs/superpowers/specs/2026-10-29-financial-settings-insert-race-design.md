# Stop the 409 when financial settings are created

Date: 2026-10-29
Source: QA of toyiyo/nimble-pnl#849, bug QA-2 (pre-existing on `main`).

## Problem

A new restaurant has no `restaurant_financial_settings` row. On the first page
load, several components mount `useFinancialSettings` at the same time
(`src/hooks/useUnifiedCOGS.tsx`, `src/components/settings/COGSPreferenceSettings.tsx`).
Each hook reads no row (`src/hooks/useFinancialSettings.tsx:46-50`) and inserts a
default row (`:71-75`). The first insert wins. The other inserts fail on
`restaurant_financial_settings_restaurant_id_unique`
(`supabase/migrations/20260303200001_create_restaurant_financial_settings.sql:11`):

- The browser shows `409 POST /rest/v1/restaurant_financial_settings` and the
  console shows `Error creating default financial settings: ... 23505`.
- The hook that lost keeps `settings = null`, so it does not show the stored row.

## Design

1. Insert with `upsert(defaultSettings, { onConflict: 'restaurant_id', ignoreDuplicates: true })`.
   PostgREST sends `ON CONFLICT DO NOTHING`, so the losers get no error.
2. Read the result with `.select()` as an array. Do not use `.maybeSingle()`:
   on a POST it asks for one object, and PostgREST answers 406 when the insert
   skips the row.
3. When the array is empty, another hook inserted the row first. Read the row
   again and keep it.

RLS does not change: the insert path needs the same INSERT policy as before.
The update path does not change.

## Alternatives

- Move the hook to React Query so that one query serves all consumers. That
  also dedups the read, but it changes 2 callers and the hook return shape.
  It is larger than this bug needs.
- Catch `23505` and read again. The 409 still shows in the browser console.

## Tests

- `tests/unit/useFinancialSettings.test.ts`: the create test expects the upsert
  options and no `insert`; a new test covers the lost race (upsert returns `[]`,
  the second read returns the row, no `console.error`).
- Browser check on local Supabase: a new restaurant gets exactly one row, and
  the page has no 406, 409, or `23505`. The old hook fails this check with the
  409 and `23505`.
