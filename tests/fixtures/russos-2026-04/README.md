# Russo's Pizzeria April 2026 — Acceptance Fixture

Snapshot of the production RPC responses for restaurant `adbd9392-928a-4a46-80d7-f7e453aa1956`, period `2026-04-01..2026-04-30`. Captured 2026-05-02 against the post-Migration-A and post-Migration-B state (i.e. with the void-row drop and the alcohol_sales mis-categorization fix already applied).

| File                       | Source                                                    | Notes                                                         |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| `revenue_by_account.json`  | `get_revenue_by_account` RPC                              | alcohol_sales adjusted from 3115.00 → 3110.00 per Migration B |
| `pass_through_totals.json` | `get_pass_through_totals` RPC                             | `void` row excluded per Migration A                           |
| `tip_splits.json`          | `tip_split_items ⋈ tip_splits` for April 2026             | Empty (Russo's does not use tip pooling in April)             |
| `employees.json`           | `employees` table — only the 20 with punches in this window | Redacted to labor-relevant fields only (no PII)             |
| `time_punches.json`        | `time_punches` for 2026-03-30 .. 2026-05-04 (ISO-week buffer) | 301 rows, no PII                                          |
| `expenses.json`            | Reserved for future bank_transactions expansion            | Currently empty                                               |

Expected pipeline output (per spec):
- `grossRevenueCents`: 7_591_782 ($75,917.82)
- `netRevenueCents`: 7_444_042 ($74,440.42)
- `posCollectedCents`: 9_227_448 ($92,274.48)
- `salesTaxCents`: 597_488
- `tipsCents`: 1_038_178
- `discountsCents`: 147_740
- `otherLiabilitiesCents`: 0
- `tipsOwedCents`: 0 (empty tip splits)
- `wagesCents`: pinned by acceptance test
