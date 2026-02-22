import { describe, it, expect } from 'vitest';

/**
 * Tests for imported_total calculation logic.
 *
 * The imported total should sum parsed_price only for items
 * with mapping_status 'mapped' or 'new_item' — NOT 'skipped' or 'pending'.
 */

export const calculateImportedTotal = (
  lineItems: Array<{ mapping_status: string; parsed_price: number | null }>
): number => {
  return lineItems
    .filter(item => item.mapping_status === 'mapped' || item.mapping_status === 'new_item')
    .reduce((sum, item) => sum + (item.parsed_price || 0), 0);
};

describe('Imported Total Calculation', () => {
  it('should sum parsed_price for mapped and new_item statuses only', () => {
    const lineItems = [
      { mapping_status: 'mapped', parsed_price: 25.50 },
      { mapping_status: 'new_item', parsed_price: 10.00 },
      { mapping_status: 'skipped', parsed_price: 15.00 },
      { mapping_status: 'pending', parsed_price: 5.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(35.50);
  });

  it('should return 0 when no items are mapped or new_item', () => {
    const lineItems = [
      { mapping_status: 'skipped', parsed_price: 15.00 },
      { mapping_status: 'pending', parsed_price: 5.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(0);
  });

  it('should handle null parsed_price as 0', () => {
    const lineItems = [
      { mapping_status: 'mapped', parsed_price: null },
      { mapping_status: 'mapped', parsed_price: 20.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(20.00);
  });

  it('should handle empty array', () => {
    const total = calculateImportedTotal([]);
    expect(total).toBe(0);
  });

  it('should sum all items when all are mapped', () => {
    const lineItems = [
      { mapping_status: 'mapped', parsed_price: 10.00 },
      { mapping_status: 'mapped', parsed_price: 20.00 },
      { mapping_status: 'mapped', parsed_price: 30.00 },
    ];

    const total = calculateImportedTotal(lineItems);
    expect(total).toBe(60.00);
  });
});
