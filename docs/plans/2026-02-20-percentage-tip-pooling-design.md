# Percentage-Based Tip Pooling Design

**Date:** 2026-02-20
**Status:** Approved

## Problem

Full-service restaurants need a different tip pooling model than QSRs. Servers earn individual tips and keep most of them, but contribute defined percentages to named pools (e.g., 5% to dishwashers, 3% to front-of-house). Each pool has its own distribution rules and eligible recipients. If a pool can't distribute (nobody worked), the money returns to the contributing servers.

## Requirements

- Two pooling models: "Full Pool" (existing QSR-style) and "Percentage Contribution" (new)
- Restaurant selects one model in settings
- Multiple named pools, each with: contribution percentage, distribution method (hours/role/even), eligible employees
- Manual per-server tip entry (POS auto-import deferred)
- Refund logic: if zero eligible employees worked for a pool, proportional refund to servers
- If any eligible employees worked, full pool amount goes to them
- No percentage cap (trust the manager)
- Existing approval, payout, audit, and dispute flows remain unchanged
- **TDD**: Tests written first, implementation built to pass them

## Approach

Extend existing tables (Approach A). Add `pooling_model` to `tip_pool_settings`, create new tables for pools and per-server tracking. Reuse `tip_splits` and `tip_split_items` as the final output format.

## Data Model

### Modified table: `tip_pool_settings`

New column:
```sql
pooling_model TEXT DEFAULT 'full_pool' CHECK (pooling_model IN ('full_pool', 'percentage_contribution'))
```

When `full_pool`: existing fields (`share_method`, `role_weights`, `enabled_employee_ids`) drive behavior.
When `percentage_contribution`: pools defined in `tip_contribution_pools`.

### New table: `tip_contribution_pools`

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| restaurant_id | UUID FK | |
| settings_id | UUID FK -> tip_pool_settings | Parent settings |
| name | TEXT | Display name (e.g., "Dishwasher Pool") |
| contribution_percentage | DECIMAL(5,2) | e.g., 5.00 for 5% |
| share_method | TEXT CHECK ('hours','role','even') | Distribution method |
| role_weights | JSONB | Only when share_method = 'role' |
| eligible_employee_ids | UUID[] | Recipients of this pool |
| sort_order | INTEGER | Display ordering |
| active | BOOLEAN DEFAULT true | Soft delete |
| created_at / updated_at | TIMESTAMPTZ | |

RLS: Managers only (same policy as `tip_pool_settings`).

### New table: `tip_server_earnings`

Per-server tip amounts for a split (input for percentage contribution).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| tip_split_id | UUID FK -> tip_splits | |
| employee_id | UUID FK | Server who earned tips |
| earned_amount | INTEGER | Gross tips earned (cents) |
| retained_amount | INTEGER | Kept after pool deductions (cents) |
| refunded_amount | INTEGER | Returned from empty pools (cents) |
| created_at | TIMESTAMPTZ | |

Unique: `(tip_split_id, employee_id)`

### New table: `tip_pool_allocations`

Per-pool distribution details within a split.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID PK | |
| tip_split_id | UUID FK -> tip_splits | |
| pool_id | UUID FK -> tip_contribution_pools | |
| total_contributed | INTEGER | Collected from all servers (cents) |
| total_distributed | INTEGER | Paid to eligible employees (cents) |
| total_refunded | INTEGER | Returned to servers (cents) |
| created_at | TIMESTAMPTZ | |

Unique: `(tip_split_id, pool_id)`

### Unchanged tables

- `tip_splits` - still the container; `total_amount` = sum of all server earnings
- `tip_split_items` - still stores final per-employee allocations
- `tip_payouts`, `tip_split_audit`, `tip_disputes` - unchanged

## Calculation Flow

### Input
- Per-server earnings: [{Maria: $200}, {John: $150}]
- Active pools: [{Dishwashers: 5%, hours, [A,B]}, {FOH: 3%, even, [C,D]}]
- Which eligible employees actually worked

### Step 1: Calculate contributions
```
Maria -> Dishwashers: $200 x 5% = $10.00
Maria -> FOH: $200 x 3% = $6.00
John -> Dishwashers: $150 x 5% = $7.50
John -> FOH: $150 x 3% = $4.50
```

### Step 2: Check pool eligibility
- If ANY eligible employee worked -> pool is active, full amount distributed
- If ZERO eligible employees worked -> pool is empty, full refund to servers

### Step 3: Distribute active pools
Use existing distribution logic (hours/role/even) on pool amount.

### Step 4: Calculate refunds for empty pools
Proportional to each server's contribution to that pool.

### Step 5: Calculate final amounts
```
Server final = earned - sum(contributions) + sum(refunds)
Pool recipient final = sum(pool distributions received)
```
Write to `tip_split_items` as combined totals.

### Rounding
All math in cents (integers). Remainder to last participant per pool. Guarantee: total in = total out.

### Manager Override
After calculation, manager can manually adjust any `tip_split_item`. Existing rebalance logic applies.

## UI Flow

### Settings (TipPoolSettingsDialog)

**New Step 0: Select Pooling Model**
- Two cards: "Full Pool" and "Percentage Contribution"

**Full Pool selected:** Steps 1-5 unchanged.

**Percentage Contribution selected:**
- Step 1: Define Pools (list of pool cards with name, percentage, method, weights, employees)
- Step 2: Select Contributing Servers
- Step 3: Cadence (daily/weekly/shift)

### Tip Entry

**Full Pool:** Unchanged (total tips for the day).

**Percentage Contribution:** New TipServerEntrySheet:
- List of contributing servers with dollar input each
- Running total
- "Calculate Split" button

### Review Screen (TipReviewScreen)

**Full Pool:** Unchanged.

**Percentage Contribution:** Shows:
1. Server Earnings: Server | Earned | Deductions | Refunds | Final
2. Pool Breakdown (collapsible): Pool | Total | Method | Per-employee allocations
3. All Allocations: Combined final amounts

### Employee View (EmployeeTips)

**Servers see:** Earned, pool contributions, refunds, final amount.
**Pool recipients see:** Amount received from each pool.

## Edge Cases

1. **Server is also pool recipient** - Combined total in `tip_split_items`
2. **All pools empty** - Servers keep 100%, split still created for audit
3. **Pool has eligible employees but none logged hours** - Same as empty pool, full refund
4. **Percentages exceed 100%** - Warning in settings at >50%, no hard block
5. **Zero-dollar server earnings** - $0 contribution, no refund participation
6. **Switching models** - Approved splits unchanged, new model applies to future splits only

## Testing Strategy (TDD - Tests First)

### Unit Tests (Vitest) - Write FIRST

New functions in `src/utils/tipPooling.ts`:
- `calculatePercentageContributions(serverEarnings, pools)` - percentage math, rounding
- `distributePool(poolAmount, eligibleEmployees, method, roleWeights)` - reuse existing
- `calculateRefunds(poolAmount, serverContributions)` - proportional refund
- `calculateFinalAllocations(serverEarnings, pools, workedEmployees)` - end-to-end

Test cases:
- Basic 2-server, 2-pool scenario
- All pools empty -> servers keep everything
- One pool active, one empty -> partial refund
- Server is also pool recipient -> combined amount
- Single cent rounding -> total in = total out
- Zero-dollar server -> no contribution, no refund

### SQL Tests (pgTAP) - Write FIRST

- `tip_contribution_pools` RLS policies
- `tip_server_earnings` unique constraint
- `tip_pool_allocations` unique constraint
- `pooling_model` check constraint

### E2E Tests (Playwright)

- Settings: create percentage contribution model with 2 pools
- Entry: enter per-server tips, verify calculation preview
- Approval: approve split, verify amounts
- Edge case: empty pool -> verify refund
- Employee view: verify breakdown shows contributions/refunds
