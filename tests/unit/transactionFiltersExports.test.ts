import { expectTypeOf, describe, it } from 'vitest';
import type { TransactionFilters as FiltersFromComponent } from '@/components/TransactionFilters';
import type { TransactionFilters as FiltersFromTypes } from '@/types/transactions';

describe('TransactionFilters exports', () => {
  it('re-exports TransactionFilters from the component entrypoint', () => {
    expectTypeOf<FiltersFromComponent>().toEqualTypeOf<FiltersFromTypes>();
  });
});
