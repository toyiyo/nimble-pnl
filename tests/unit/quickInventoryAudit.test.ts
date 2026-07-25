import { describe, it, expect } from 'vitest';
import { buildQuickInventoryAudit } from '@/utils/quickInventoryAudit';

describe('buildQuickInventoryAudit', () => {
  it('preserves the exact scan + add wording (raw quantity, no rounding)', () => {
    const { reason } = buildQuickInventoryAudit('scan', 'add', 3.5, 1000);
    expect(reason).toBe('Adjustment - Added 3.5 via quick scan');
  });

  it('preserves the exact scan + reconcile wording', () => {
    const { reason } = buildQuickInventoryAudit('scan', 'reconcile', 12, 1000);
    expect(reason).toBe('Inventory reconciliation - Set to 12 via quick scan');
  });

  it('labels manual + add as "via manual count"', () => {
    const { reason } = buildQuickInventoryAudit('manual', 'add', 3.5, 1000);
    expect(reason).toBe('Adjustment - Added 3.5 via manual count');
  });

  it('labels manual + reconcile as "via manual count"', () => {
    const { reason } = buildQuickInventoryAudit('manual', 'reconcile', 12, 1000);
    expect(reason).toBe('Inventory reconciliation - Set to 12 via manual count');
  });

  it('prefixes the scan reference with quick_scan_ and includes the timestamp', () => {
    const { reference } = buildQuickInventoryAudit('scan', 'add', 1, 1737700000000);
    expect(reference).toBe('quick_scan_1737700000000');
  });

  it('prefixes the manual reference with manual_count_ and includes the timestamp', () => {
    const { reference } = buildQuickInventoryAudit('manual', 'add', 1, 1737700000000);
    expect(reference).toBe('manual_count_1737700000000');
  });

  it('does not round or reformat the quantity', () => {
    const { reason } = buildQuickInventoryAudit('manual', 'add', 0.333333, 1000);
    expect(reason).toBe('Adjustment - Added 0.333333 via manual count');
  });
});
