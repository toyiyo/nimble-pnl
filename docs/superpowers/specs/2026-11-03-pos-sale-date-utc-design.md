# POS sale dates use the wrong day: design

## Problem

Three places in the POS Sales flow get a calendar day from `toISOString()`.
This call gives the UTC day, not the day at the restaurant.

1. **Manual sale default.** `src/components/POSSaleDialog.tsx:97` and `:131` use
   `new Date().toISOString().split('T')[0]`. After 18:00 CST the UTC day is the
   next day. The sale gets tomorrow's date. The default page range ends today
   (`src/pages/POSSales.tsx:173`), and the page filter excludes the sale
   (`src/pages/POSSales.tsx:430-431`). The page shows `0 sales`.
2. **CSV date column.** `src/components/POSSalesFileUpload.tsx:132-134` parses the
   text with `new Date()`, then calls `toISOString()`. Measured results:

   | Text | `TZ=America/Chicago` | `TZ=Pacific/Auckland` |
   |---|---|---|
   | `2026-11-03` | `2026-11-03` | `2026-11-03` |
   | `11/03/2026` | `2026-11-03` | `2026-11-02` (wrong) |
   | `11/03/2026 22:30` | `2026-11-04` (wrong) | `2026-11-03` |

3. **Date from the file name.** `src/components/POSSalesFileUpload.tsx:349` calls
   `toISOString()` on a local midnight date
   (`src/utils/filenameDateExtraction.ts:24`). East of UTC, the result is the
   previous day.

The sale date goes to P&L, so a wrong day puts revenue on the wrong day.

## Related existing behavior

- `saleTime` default uses the browser clock (`src/components/POSSaleDialog.tsx:98`, `:132`).
- `formatDateInTimezone` formats a `Date` in an IANA zone (`src/lib/timezone.ts:7`).
- `safeTz` maps a missing zone to the restaurant default
  (`supabase/functions/_shared/labor/restaurantClock.ts:93`), and
  `src/lib/restaurantClock.ts:3` exports it.
- `POSSales` returns early without a restaurant (`src/pages/POSSales.tsx:910`),
  and it renders the dialog after this guard (`src/pages/POSSales.tsx:1648`).
- The dialog does not read `RestaurantContext`. Its unit tests do not mock it
  (`tests/unit/POSSaleDialog.scroll.test.tsx:32`).
- The import finds duplicates by `external_order_id`, not by date
  (`src/components/POSSalesImportReview.tsx:276-287`).

## Approaches

- **A (recommended): one small helper for each date source.** The dialog gets a
  `timezone` prop and uses the restaurant clock. The CSV path keeps the day
  that the text states.
- **B: use the browser clock in the dialog.** This is smaller, but it gives the
  wrong day when the manager is not in the restaurant time zone.
- **C: read `RestaurantContext` in the dialog.** This has the same result as A,
  but every dialog unit test must then mock the context.

## Design (approach A)

- Add `getSaleDateTimeDefaults(timezone, now = new Date())` to
  `src/lib/timezone.ts`. It returns `{ saleDate, saleTime }`, formatted with
  `formatDateInTimezone`. Date and time come from the same zone.
- Add a required `timezone: string` prop to `POSSaleDialog`. `POSSales` passes
  `safeTz(selectedRestaurant.restaurant?.timezone)`.
- Add `toImportedSaleDate(text)` to `src/lib/timezone.ts`. It returns text in
  `YYYY-MM-DD` form with no change. For other text, it parses with `new Date()`
  and formats the local fields with `yyyy-MM-dd`. For text that it cannot
  parse, it returns `''`. This keeps the current behavior of line 136.
- Change `src/components/POSSalesFileUpload.tsx:349` to format the local fields
  of `detectedDate.date`.

Saved sales do not change. A user-entered date does not change. The edit path
of the dialog does not change.

## Decided trade-offs

- **Timestamps with an offset.** Text such as `2026-11-04T03:00:00Z` uses the
  browser day, not the restaurant day. The CSV path has no time zone today, and
  most POS exports have no offset.
- **Page range.** The default range at `src/pages/POSSales.tsx:172-173` stays on
  the browser clock. If the restaurant is ahead of the browser, a new sale can
  fall after the range end for a short time. The user can change the range.
- **Past imports.** This change does not fix sales that are already saved with
  the wrong day. A data fix needs a separate decision.
- **Same CSV imported again.** Rows that have an order ID stay duplicates
  because the check does not use the date. Rows without an order ID get a new
  fallback ID (`src/components/POSSalesImportReview.tsx:237`), as they do today.

## Tests

- Unit: `getSaleDateTimeDefaults` at 22:46 CST gives the restaurant day and time.
- Unit: `toImportedSaleDate` for each row of the table above, under two zones.
- Unit: `POSSaleDialog` shows the restaurant day as the default with fake time.
- E2E: `tests/e2e/manual-sale-tip-not-doubled.spec.ts` passes after 18:00 CST.
