# Testing Guide

This project uses **Vitest** for fast, reliable unit testing.

## Quick Start

```bash
# Run all tests
npm test

# Run tests in watch mode (for development)
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

---

## 📊 Dashboard Calculations Explained

This section documents how financial metrics are calculated on the dashboard. These formulas are validated by 170+ unit tests.

### Revenue Calculations

#### Data Sources
- **Primary**: `unified_sales` table (aggregated POS data from Square, Clover, etc.)
- **Split handling**: Parent sales with children are excluded to prevent double-counting

#### Formulas

| Metric | Formula | Description |
|--------|---------|-------------|
| **Gross Revenue** | Sum of all `sale` items where `account_type = 'revenue'` | Total food & beverage sales before deductions |
| **Discounts** | Sum of `item_type = 'discount'` (absolute value) | Coupons, comps, employee discounts |
| **Refunds** | Sum of `item_type = 'refund'` (absolute value) | Returned items, voided transactions |
| **Net Revenue** | `gross_revenue - discounts - refunds` | Actual revenue earned |

```
Net Revenue = Gross Revenue - Discounts - Refunds
```

#### Pass-Through Items (NOT Revenue)

These are collected at the POS but belong to others:

| Type | Classification Logic | Destination |
|------|---------------------|-------------|
| **Sales Tax** | `account_subtype` contains "sales" AND "tax", OR `account_name` contains "tax" | `sales_tax` liability |
| **Tips** | `account_subtype` contains "tip", OR `account_name` contains "tip" | `tips` liability |
| **Service Charges** | Other liability subtypes (delivery fees, service fees) | `other_liabilities` |

```
Total Collected at POS = Gross Revenue + Sales Tax + Tips + Other Liabilities
```

### Cost Calculations

#### Data Sources
- **Food Cost**: `inventory_transactions` table (type = 'usage')
- **Labor Cost**: 
  - Pending: `daily_labor_costs` (from time punches)
  - Actual: `bank_transactions` + `pending_outflows` (categorized as labor)

#### Formulas

| Metric | Formula | Industry Benchmark |
|--------|---------|-------------------|
| **Food Cost %** | `(food_cost / net_revenue) × 100` | 28-32% (good), 33-35% (caution), >35% (high) |
| **Labor Cost %** | `(labor_cost / net_revenue) × 100` | 25-30% (good), 31-35% (caution), >35% (high) |
| **Prime Cost** | `food_cost + labor_cost` | — |
| **Prime Cost %** | `(prime_cost / net_revenue) × 100` | 55-60% (good), 61-65% (caution), >65% (high) |

```
Prime Cost = Food Cost + Labor Cost
Prime Cost % = (Prime Cost / Net Revenue) × 100
```

### Profitability Calculations

| Metric | Formula | What it Tells You |
|--------|---------|-------------------|
| **Gross Profit** | `net_revenue - prime_cost` | Money left after food & labor |
| **Profit Margin** | `(gross_profit / net_revenue) × 100` | Percentage kept as profit |

```
Gross Profit = Net Revenue - Prime Cost
Profit Margin = (Gross Profit / Net Revenue) × 100
```

### Example Calculation

**Saturday Dinner Service:**
```
Sales:
  Food Sales:          $5,000
  Bar Sales:           $2,500
  ─────────────────────────────
  Gross Revenue:       $7,500

Deductions:
  Discounts:           -$100
  Refunds:             -$150
  ─────────────────────────────
  Net Revenue:         $7,250

Pass-Through (collected but not revenue):
  Sales Tax (8.25%):   $618.75
  Tips (15%):          $1,125.00
  Service Charges:     $200.00
  ─────────────────────────────
  Total at POS:        $9,193.75

Costs:
  Food Cost:           $2,100 (29% of net)
  Labor Cost:          $2,175 (30% of net)
  ─────────────────────────────
  Prime Cost:          $4,275 (59% of net)

Profitability:
  Gross Profit:        $2,975
  Profit Margin:       41%
```
Sales:
  Food Sales:          $5,000
  Bar Sales:           $2,500
  ─────────────────────────────
  Gross Revenue:       $7,500

Deductions:
  Discounts:           -$100
  Refunds:             -$150
  ─────────────────────────────
  Net Revenue:         $7,250

Pass-Through (collected but not revenue):
  Sales Tax (8.25%):   $618.75
  Tips (15%):          $1,125.00
  Service Charges:     $200.00
  ─────────────────────────────
  Total at POS:        $9,193.75

Costs:
  Food Cost:           $2,100 (29% of net)
  Labor Cost:          $2,175 (30% of net)
  ─────────────────────────────
  Prime Cost:          $4,275 (59% of net)

Profitability:
  Gross Profit:        $2,975
  Profit Margin:       41%
```

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| **Zero revenue** | Cost percentages = 0% (not infinity) |
| **Costs > Revenue** | Negative profit, percentages can exceed 100% |
| **Split sales (combos)** | Parent excluded, only children counted |
| **Uncategorized sales** | Treated as revenue (fallback) |
| **Missing chart_account** | Falls back to `adjustment_type` |

### Monthly Metrics

Monthly aggregation uses the same formulas but:
- **Amounts stored in cents** to avoid floating-point precision issues
- **Classification priority**: Chart account → adjustment_type → skip

---

### Edge Cases Handled

| Scenario | Behavior |
|----------|----------|
| **Zero revenue** | Cost percentages = 0% (not infinity) |
| **Costs > Revenue** | Negative profit, percentages can exceed 100% |
| **Split sales (combos)** | Parent excluded, only children counted |
| **Uncategorized sales** | Treated as revenue (fallback) |
| **Missing chart_account** | Falls back to `adjustment_type` |

### Monthly Metrics

Monthly aggregation uses the same formulas but:
- **Amounts stored in cents** to avoid floating-point precision issues
- **Classification priority**: Chart account → adjustment_type → skip

---

## Project Structure

```
tests/
├── unit/                              # Unit tests
│   ├── calculator.test.ts             # Calculator expression parser
│   ├── filenameDateExtraction.test.ts # Date extraction from filenames
│   ├── periodMetrics.test.ts          # Core dashboard calculation functions
│   ├── dashboardScenarios.test.ts     # Realistic restaurant scenario tests
│   ├── monthlyMetrics.test.ts         # Monthly adjustment classification
│   ├── passThroughAdjustments.test.ts # POS pass-through classification
│   ├── inventoryConversion.test.ts    # Inventory unit conversion logic
│   └── inventoryScenarios.test.ts     # Comprehensive inventory edge cases
├── setup.ts                           # Test setup file
└── README.md                          # This file
```

## Test Coverage Areas

### 🎯 Critical Business Logic (High Priority)

| Module | Description | Coverage | Tests |
|--------|-------------|----------|-------|
| `periodMetrics.ts` | Dashboard revenue, costs, profit calculations | ✅ 100% | 37 |
| `monthlyMetrics.ts` | Monthly adjustment classification | ✅ 100% | 30 |
| `passThroughAdjustments.ts` | POS tax/tip/fee classification | ✅ 100% | 33 |
| `inventoryConversion.ts` | Unit conversions for inventory deductions | ✅ 100% | 67+53 |
| `calculator.ts` | Inventory quantity expressions | ✅ 97% | 20 |
| Dashboard Scenarios | End-to-end financial validation | N/A | 41 |
| Inventory Scenarios | Real-world inventory edge cases | N/A | 53 |

### 📊 Dashboard Calculations

The `periodMetrics.test.ts` and `dashboardScenarios.test.ts` cover:
- **Revenue breakdown**: gross revenue, net revenue, discounts, refunds
- **Cost breakdown**: food cost %, labor cost %, prime cost %
- **Profitability**: gross profit, profit margin
- **Benchmarks**: industry standard comparisons (good/caution/high)
- **Split sales handling**: prevents double-counting parent/child sales
- **Real-world scenarios**: lunch service, busy Saturday, slow Monday (losses)

### 📦 Inventory Conversion Logic

The `inventoryConversion.test.ts` and `inventoryScenarios.test.ts` validate the critical unit conversion logic from the `process_unified_inventory_deduction` database function:

#### Volume Conversions
| Unit | Conversion to ml |
|------|-----------------|
| fl oz | × 29.5735 |
| cup | × 236.588 |
| tbsp | × 14.7868 |
| tsp | × 4.92892 |
| l | × 1000 |
| gal | × 3785.41 |
| qt | × 946.353 |

#### Weight Conversions
| Unit | Conversion to grams |
|------|---------------------|
| kg | × 1000 |
| lb | × 453.592 |
| oz | × 28.3495 |

#### Density Conversions (Volume ↔ Weight)
For volume-to-weight conversions (e.g., "1 cup flour" to grams), density constants are used:

| Product | g/cup | Use Case |
|---------|-------|----------|
| Rice | 185 | Recipe calls for cups, purchased by lb |
| Flour | 120 | Recipe calls for cups, purchased by kg |
| Sugar | 200 | Recipe calls for cups, purchased by oz |
| Butter | 227 | Recipe calls for cups, purchased by lb |

#### Test Scenarios
- **Volume-to-volume**: fl oz → gallon, tsp → liter, cups → ml
- **Weight-to-weight**: oz → lb, g → kg, lb → oz
- **Volume-to-weight with density**: cups rice → lb, cups flour → kg
- **Fallback behavior**: Incompatible units, missing density data
- **Edge cases**: Zero quantities, very small/large values

#### Inventory Scenarios (inventoryScenarios.test.ts)

Real-world restaurant scenarios with 53 comprehensive tests:

| Scenario | Tests | Description |
|----------|-------|-------------|
| **Bar Operations** | 7 | Cocktail production, wine service, high-volume nights |
| **Kitchen Operations** | 10 | Protein portioning, bakery (density), sauce production |
| **Edge Cases** | 10 | Tiny quantities, catering scale, zero/null values |
| **Cost Accuracy** | 4 | Pour cost, food cost, batch validation |
| **Reference IDs** | 6 | Duplicate detection, special characters |
| **Math Consistency** | 10 | Inverse conversions, unit equivalencies, scaling |
| **Reconciliation** | 3 | Weekly usage validation, waste factors |
| **Multi-Location** | 1 | Batch vs incremental processing consistency |

Example validations:
- 100 Moscow Mules (2 oz vodka each) = 7.89 bottles (750ml)
- 1000-person event (6 oz chicken) = 9.38 cases (40 lb)
- 1 gallon = 4 quarts (mathematical identity)
- Weekly vodka usage matches POS sales count

### 📅 Monthly Metrics

The `monthlyMetrics.test.ts` covers:
- **Categorized adjustments**: Classification by chart_account (subtype/name)
- **Uncategorized adjustments**: Fallback to adjustment_type
- **Accumulation**: Multiple adjustments per month
- **POS integration**: Square, Clover patterns

### 🏪 POS Data Classification

The `passThroughAdjustments.test.ts` covers:
- **Tax identification**: Sales tax, VAT, GST from various sources
- **Tip handling**: Credit tips, cash tips, gratuity
- **Service charges**: Dual pricing, service fees
- **Discounts & refunds**: Proper categorization
- **Multiple POS formats**: Square, Clover, Toast patterns

## Writing Tests

### Test Template

```typescript
import { describe, it, expect } from 'vitest';
import { myFunction } from '@/utils/myModule';

describe('My Module', () => {
  describe('myFunction', () => {
    it('should handle basic case', () => {
      const result = myFunction('input');
      expect(result).toBe('expected');
    });

    it('should handle edge case', () => {
      const result = myFunction('');
      expect(result).toBeNull();
    });
  });
});
```

### Best Practices

1. **Test pure functions first** - Start with utility functions that have no side effects
2. **Use descriptive test names** - `it('should return null for empty input')` is better than `it('works')`
3. **One assertion per concept** - Keep tests focused on a single behavior
4. **Use path aliases** - Import from `@/utils/...` for consistency
5. **Test mathematical identities** - Verify that `net_revenue = gross_revenue - discounts - refunds`

## What to Test

Focus on testing:
- **Utility functions** - Pure calculations, formatters, parsers
- **Business logic** - Financial calculations, validation rules
- **Data transformations** - CSV parsing, data mapping
- **Mathematical identities** - Verify relationships between calculated values

Don't test:
- React components (UI only)
- Supabase queries (requires integration tests)
- Third-party library behavior

## CI/CD Integration

Unit tests run automatically on:
- Push to `main`, `develop`, or `feature/**` branches
- Pull requests to `main` or `develop`
- Manual workflow dispatch

See `.github/workflows/unit-tests.yml` for configuration.

## Coverage

Run `npm run test:coverage` to generate a coverage report. The report shows:
- Statement coverage
- Branch coverage
- Function coverage
- Line coverage

Coverage reports are saved to the `coverage/` directory.

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest API Reference](https://vitest.dev/api/)
