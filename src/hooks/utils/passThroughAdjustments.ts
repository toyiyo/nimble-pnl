const PASS_THROUGH_TYPES = new Set(['tax', 'tip', 'service_charge', 'discount', 'fee']);

export interface PassThroughRow {
  item_type?: string | null;
  adjustment_type?: string | null;
}

/**
 * Split sales rows into revenue vs pass-through based on item_type.
 * Some older adjustment rows may not have adjustment_type set, so we
 * treat tax/tip/service_charge/discount/fee item types as pass-throughs.
 */
export function splitPassThroughSales<T extends PassThroughRow>(sales: T[] | null | undefined) {
  const revenue: T[] = [];
  const passThrough: T[] = [];

  (sales || []).forEach((row) => {
    const itemType = String(row.item_type || '').toLowerCase();
    if (PASS_THROUGH_TYPES.has(itemType)) {
      passThrough.push(row);
    } else {
      revenue.push(row);
    }
  });

  return { revenue, passThrough };
}

/**
 * Combine adjustments with pass-through rows from the sales query,
 * normalizing adjustment_type when it was missing on the original row.
 */
export function normalizeAdjustmentsWithPassThrough<T extends PassThroughRow>(
  adjustments: T[] | null | undefined,
  passThrough: T[] | null | undefined
) {
  const normalizedPassThrough = (passThrough || []).map((row) => ({
    ...row,
    adjustment_type: (row.adjustment_type || row.item_type || 'adjustment')?.toString().toLowerCase(),
  }));

  return [...(adjustments || []), ...normalizedPassThrough];
}
