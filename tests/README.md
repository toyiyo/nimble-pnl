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

## Project Structure

```
tests/
├── unit/                              # Unit tests
│   ├── calculator.test.ts             # Calculator expression parser
│   ├── filenameDateExtraction.test.ts # Date extraction from filenames
│   ├── periodMetrics.test.ts          # Core dashboard calculation functions
│   ├── dashboardScenarios.test.ts     # Realistic restaurant scenario tests
│   ├── monthlyMetrics.test.ts         # Monthly adjustment classification
│   └── passThroughAdjustments.test.ts # POS pass-through classification
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
| `calculator.ts` | Inventory quantity expressions | ✅ 97% | 20 |
| Dashboard Scenarios | End-to-end financial validation | N/A | 41 |

### 📊 Dashboard Calculations

The `periodMetrics.test.ts` and `dashboardScenarios.test.ts` cover:
- **Revenue breakdown**: gross revenue, net revenue, discounts, refunds
- **Cost breakdown**: food cost %, labor cost %, prime cost %
- **Profitability**: gross profit, profit margin
- **Benchmarks**: industry standard comparisons (good/caution/high)
- **Split sales handling**: prevents double-counting parent/child sales
- **Real-world scenarios**: lunch service, busy Saturday, slow Monday (losses)

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
