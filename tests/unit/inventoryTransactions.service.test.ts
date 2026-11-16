import { describe, it, expect, vi } from 'vitest';
import { fetchInventoryTransactions } from '@/services/inventoryTransactions.service';

function makeClient() {
  const calls: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order', 'limit', 'in']) {
    builder[m] = vi.fn(() => builder);
  }
  builder.or = vi.fn((filter: string) => {
    calls.push(filter);
    return builder;
  });
  builder.then = (resolve: (v: unknown) => unknown) =>
    resolve({ data: [], error: null });
  const client = { from: vi.fn(() => builder) } as unknown as Parameters<typeof fetchInventoryTransactions>[0];
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
      'reason.ilike."%Smith, John%",reference_id.ilike."%Smith, John%"'
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

  it('does not run ilike on the performed_by uuid column', async () => {
    const { client, calls } = makeClient();
    await fetchInventoryTransactions(client, {
      restaurantId: 'r1',
      searchTerm: 'flour',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain('performed_by');
  });
});
