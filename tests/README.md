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
├── unit/                          # Unit tests
│   ├── calculator.test.ts         # Calculator utility tests
│   └── filenameDateExtraction.test.ts  # Date extraction tests
├── setup.ts                       # Test setup file
└── README.md                      # This file
```

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

## What to Test

Focus on testing:
- **Utility functions** - Pure calculations, formatters, parsers
- **Business logic** - Financial calculations, validation rules
- **Data transformations** - CSV parsing, data mapping

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
