const PASS_THROUGH_TYPES = new Set(['tax', 'tip', 'service_charge', 'discount', 'fee']);

export interface PassThroughRow {
  item_type?: string | null;
  adjustment_type?: string | null;
  is_categorized?: boolean;
  chart_account?: {
    account_type?: string | null;
    account_subtype?: string | null;
    account_name?: string | null;
  } | null;
}

function normalizeAdjustmentType(row: PassThroughRow) {
  return (row.adjustment_type || row.item_type || 'adjustment')?.toString().toLowerCase();
}

// Pass-through classification types
export type PassThroughType = 'tax' | 'tip' | 'service_charge' | 'fee' | 'discount' | 'other';

/**
 * Classify a pass-through item as tax, tip, service_charge, fee, discount, or other.
 * Uses chart_account properties for categorized liability items, falls back to adjustment_type.
 * 
 * This handles the case where sales tax items have item_type: 'sale' but are mapped
 * to a liability account like "Sales Tax Payable" (account 2004).
 */
export function classifyPassThroughItem(item: PassThroughRow): PassThroughType {
  const isCategorized = !!item.is_categorized && !!item.chart_account;
  
  if (isCategorized) {
    const accountType = (item.chart_account?.account_type || '').toLowerCase();
    const subtype = (item.chart_account?.account_subtype || '').toLowerCase();
    const accountName = (item.chart_account?.account_name || '').toLowerCase();
    
    // Only classify liability accounts as pass-through
    if (accountType === 'liability') {
      // Check for tax
      if ((subtype.includes('sales') && subtype.includes('tax')) ||
          subtype === 'sales_tax' ||
          accountName.includes('tax')) {
        return 'tax';
      }
      // Check for tip
      if (subtype.includes('tip') || subtype === 'tips' || accountName.includes('tip')) {
        return 'tip';
      }
      // Other liabilities (service charges, fees, etc.)
      return 'other';
    }
  }
  
  // Fall back to adjustment_type for uncategorized items or non-liability accounts
  const adjustmentType = (item.adjustment_type || '').toLowerCase();
  if (adjustmentType === 'tax') return 'tax';
  if (adjustmentType === 'tip') return 'tip';
  if (adjustmentType === 'service_charge') return 'service_charge';
  if (adjustmentType === 'fee') return 'fee';
  if (adjustmentType === 'discount') return 'discount';
  
  return 'other';
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
