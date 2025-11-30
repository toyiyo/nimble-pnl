const PASS_THROUGH_TYPES = new Set(['tax', 'tip', 'service_charge', 'discount', 'fee']);

export interface PassThroughRow {
  item_type?: string | null;
  adjustment_type?: string | null;
  chart_account?: {
    account_type?: string | null;
    account_subtype?: string | null;
    account_name?: string | null;
  } | null;
}

function normalizeAdjustmentType(row: PassThroughRow) {
  return (row.adjustment_type || row.item_type || 'adjustment')?.toString().toLowerCase();
}

/**
 * Split sales rows into revenue vs pass-through based on item_type.
 * Some older adjustment rows may not have adjustment_type set, so we
 * treat tax/tip/service_charge/discount/fee item types as pass-throughs.
 * Also treat any liability-mapped rows as pass-through to keep gross
 * revenue clean and classify them with liabilities.
 */
export function splitPassThroughSales<T extends PassThroughRow>(sales: T[] | null | undefined) {
  const revenue: T[] = [];
  const passThrough: T[] = [];

  (sales || []).forEach((row) => {
    const normalizedType = normalizeAdjustmentType(row);
    const isLiability = (row.chart_account?.account_type || '').toLowerCase() === 'liability';
    if (PASS_THROUGH_TYPES.has(normalizedType) || isLiability) {
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
  const normalizedAdjustments = (adjustments || []).map((row) => ({
    ...row,
    adjustment_type: normalizeAdjustmentType(row),
  }));

  const normalizedPassThrough = (passThrough || []).map((row) => ({
    ...row,
    adjustment_type: normalizeAdjustmentType(row),
  }));

  return [...normalizedAdjustments, ...normalizedPassThrough];
}
