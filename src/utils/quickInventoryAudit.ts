export type QuickEntrySource = 'scan' | 'manual';
export type QuickEntryMode = 'add' | 'reconcile';

/**
 * Builds the inventory audit-log `reason` and `reference` strings for a
 * quick inventory entry (barcode scan or manual tap-to-count).
 *
 * Pure and unit-testable: the caller supplies `timestamp` (e.g. `Date.now()`)
 * so this function has no hidden dependency on the system clock.
 *
 * `quantity` is interpolated raw/unformatted to preserve the exact wording
 * of the existing scan-path audit strings byte-for-byte.
 */
export function buildQuickInventoryAudit(
  source: QuickEntrySource,
  mode: QuickEntryMode,
  quantity: number,
  timestamp: number,
): { reason: string; reference: string } {
  const sourceLabel = source === 'manual' ? 'via manual count' : 'via quick scan';
  const reason =
    mode === 'add'
      ? `Adjustment - Added ${quantity} ${sourceLabel}`
      : `Inventory reconciliation - Set to ${quantity} ${sourceLabel}`;

  const referencePrefix = source === 'manual' ? 'manual_count' : 'quick_scan';
  const reference = `${referencePrefix}_${timestamp}`;

  return { reason, reference };
}
