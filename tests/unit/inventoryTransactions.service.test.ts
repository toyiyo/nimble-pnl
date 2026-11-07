import { describe, it, expect, vi } from 'vitest';
import { fetchInventoryTransactions } from '@/services/inventoryTransactions.service';

function makeClient() {
  const calls: string[] = [];
  const builder: any = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.or = vi.fn((filter: string) => {
    calls.push(filter);
    return builder;
  });
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  const client: any = { from: vi.fn(() => builder) };
  return { client, calls };
}

describe('fetchInventoryTransactions search term', () => {
  it('quotes a term that contains a comma', async () => {
    const { client, calls } = makeClient();
    await fetchInventoryTransactions(client, {
      restaurantId: 'r1',
      searchTerm: 'Smith, John',
    });
    expect(calls).toContain(
      'reason.ilike."%Smith, John%",reference_id.ilike."%Smith, John%",performed_by.ilike."%Smith, John%"'
    );
  });

  it('escapes a double quote in the term', async () => {
    const { client, calls } = makeClient();
    await fetchInventoryTransactions(client, {
      restaurantId: 'r1',
      searchTerm: 'a"b',
    });
    expect(calls[0]).toContain('reason.ilike."%a\\"b%"');
  });
});
