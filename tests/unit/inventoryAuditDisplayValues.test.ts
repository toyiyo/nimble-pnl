import { describe, it, expect } from 'vitest';
import { computeAuditDisplayValues } from '@/lib/inventoryAuditUtils';

const makeTransaction = (overrides: Record<string, any> = {}) => ({
  id: 'txn-1',
  product_name: 'Tomatoes',
  quantity: 10,
  unit_cost: 2.5,
  total_cost: 25,
  transaction_type: 'purchase',
  reason: null as string | null,
  reference_id: null as string | null,
  created_at: '2026-02-21T10:30:00Z',
  transaction_date: null as string | null,
  performed_by: 'user-1',
  ...overrides,
});

describe('computeAuditDisplayValues', () => {
  const timezone = 'America/New_York';

  it('formats positive quantity with + prefix', () => {
    const result = computeAuditDisplayValues(makeTransaction({ quantity: 10 }), timezone);
    expect(result.formattedQuantity).toBe('+10.00');
    expect(result.isPositiveQuantity).toBe(true);
  });

  it('formats negative quantity without + prefix', () => {
    const result = computeAuditDisplayValues(makeTransaction({ quantity: -5.5 }), timezone);
    expect(result.formattedQuantity).toBe('-5.50');
    expect(result.isPositiveQuantity).toBe(false);
  });

  it('formats unit cost as currency', () => {
    const result = computeAuditDisplayValues(makeTransaction({ unit_cost: 2.5 }), timezone);
    expect(result.formattedUnitCost).toBe('$2.50');
  });

  it('formats null unit cost as $0.00', () => {
    const result = computeAuditDisplayValues(makeTransaction({ unit_cost: null }), timezone);
    expect(result.formattedUnitCost).toBe('$0.00');
  });

  it('formats total cost as absolute value', () => {
    const result = computeAuditDisplayValues(makeTransaction({ total_cost: -25 }), timezone);
    expect(result.formattedTotalCost).toBe('$25.00');
    expect(result.isPositiveCost).toBe(false);
  });

  it('returns correct badge color for purchase type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'purchase' }), timezone);
    expect(result.badgeColor).toContain('emerald');
  });

  it('returns correct badge color for usage type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'usage' }), timezone);
    expect(result.badgeColor).toContain('rose');
  });

  it('returns correct badge color for adjustment type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'adjustment' }), timezone);
    expect(result.badgeColor).toContain('blue');
  });

  it('returns correct badge color for waste type', () => {
    const result = computeAuditDisplayValues(makeTransaction({ transaction_type: 'waste' }), timezone);
    expect(result.badgeColor).toContain('amber');
  });

  it('detects VOL conversion badge from reason', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ reason: 'Deducted 2 units ✓ VOL converted' }),
      timezone
    );
    expect(result.conversionBadges).toContain('volume');
  });

  it('detects WEIGHT conversion badge from reason', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ reason: 'Deducted 1 unit ✓ WEIGHT converted' }),
      timezone
    );
    expect(result.conversionBadges).toContain('weight');
  });

  it('detects FALLBACK badge from reason', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ reason: '⚠️ FALLBACK 1:1 ratio used' }),
      timezone
    );
    expect(result.conversionBadges).toContain('fallback');
  });

  it('returns empty conversion badges when reason is null', () => {
    const result = computeAuditDisplayValues(makeTransaction({ reason: null }), timezone);
    expect(result.conversionBadges).toEqual([]);
  });

  it('uses transaction_date when available for formatting', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ transaction_date: '2026-02-20', created_at: '2026-02-21T10:00:00Z' }),
      timezone
    );
    expect(result.formattedDate).toContain('Feb');
    expect(result.formattedDate).toContain('20');
    expect(result.formattedDate).not.toContain(':');
  });

  it('uses created_at with time when transaction_date is null', () => {
    const result = computeAuditDisplayValues(
      makeTransaction({ transaction_date: null, created_at: '2026-02-21T10:30:00Z' }),
      timezone
    );
    expect(result.formattedDate).toContain('Feb');
    expect(result.formattedDate).toContain('21');
    expect(result.formattedDate).toContain(':');
  });
});
