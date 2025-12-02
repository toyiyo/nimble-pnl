const PASS_THROUGH_TYPES = new Set(['tax', 'tip', 'service_charge', 'discount', 'fee']);

// Keywords to identify pass-through items by item_name
// These are matched as whole words or at word boundaries to avoid false positives
const TAX_KEYWORDS = ['sales tax', 'mb sales tax', 'state tax', 'local tax', 'vat', 'gst', 'hst'];
const TIP_KEYWORDS = ['tip', 'credit tip', 'cash tip', 'gratuity'];
const SERVICE_CHARGE_KEYWORDS = ['service charge', 'service fee', 'dual pricing'];
const DISCOUNT_KEYWORDS = ['discount', 'comp', 'coupon', 'promo'];
const FEE_KEYWORDS = ['delivery fee', 'platform fee', 'processing fee'];

export interface PassThroughRow {
  item_type?: string | null;
  item_name?: string | null;
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

/**
 * Check if item_name contains any of the given keywords as whole words or at word boundaries.
 * Uses word boundary matching to avoid false positives (e.g., 'taxation' matching 'tax').
 */
function itemNameContainsKeyword(itemName: string | null | undefined, keywords: string[]): boolean {
  if (!itemName) return false;
  const lowerName = itemName.toLowerCase();
  return keywords.some(keyword => {
    // Create a regex that matches the keyword as a whole word (at word boundaries)
    // or at the start/end of the string
    const pattern = new RegExp(`(^|\\s|-)${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|-)`, 'i');
    return pattern.test(lowerName);
  });
}

/**
 * Determine the pass-through type based on item_name.
 * Returns null if the item_name doesn't indicate a pass-through type.
 */
function getPassThroughTypeFromItemName(itemName: string | null | undefined): PassThroughType | null {
  if (itemNameContainsKeyword(itemName, TAX_KEYWORDS)) return 'tax';
  if (itemNameContainsKeyword(itemName, TIP_KEYWORDS)) return 'tip';
  if (itemNameContainsKeyword(itemName, SERVICE_CHARGE_KEYWORDS)) return 'service_charge';
  if (itemNameContainsKeyword(itemName, DISCOUNT_KEYWORDS)) return 'discount';
  if (itemNameContainsKeyword(itemName, FEE_KEYWORDS)) return 'fee';
  return null;
}

// Pass-through classification types
export type PassThroughType = 'tax' | 'tip' | 'service_charge' | 'fee' | 'discount' | 'other';

/**
 * Classify a pass-through item as tax, tip, service_charge, fee, discount, or other.
 * Uses chart_account properties for categorized liability items, falls back to adjustment_type,
 * and finally checks item_name for common pass-through keywords.
 * 
 * This handles the case where sales tax items have item_type: 'sale' but are mapped
 * to a liability account like "Sales Tax Payable" (account 2004), or have item_name
 * like "Sales Tax" even when not yet categorized.
 */
export function classifyPassThroughItem(item: PassThroughRow): PassThroughType {
  const isCategorized = !!item.is_categorized && !!item.chart_account;
  
  // 1. Check chart_account for categorized liability items
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
  
  // 2. Check adjustment_type
  const adjustmentType = (item.adjustment_type || '').toLowerCase();
  if (adjustmentType === 'tax') return 'tax';
  if (adjustmentType === 'tip') return 'tip';
  if (adjustmentType === 'service_charge') return 'service_charge';
  if (adjustmentType === 'fee') return 'fee';
  if (adjustmentType === 'discount') return 'discount';
  
  // 3. Check item_name for pass-through keywords
  const itemNameType = getPassThroughTypeFromItemName(item.item_name);
  if (itemNameType) return itemNameType;
  
  return 'other';
}

/**
 * Split sales rows into revenue vs pass-through based on item_type, item_name, and chart_account.
 * Some older adjustment rows may not have adjustment_type set, so we:
 * - Treat tax/tip/service_charge/discount/fee item types as pass-throughs
 * - Treat any liability-mapped rows as pass-through to keep gross revenue clean
 * - Check item_name for tax/tip/service_charge keywords to catch uncategorized pass-through items
 */
export function splitPassThroughSales<T extends PassThroughRow>(sales: T[] | null | undefined) {
  const revenue: T[] = [];
  const passThrough: T[] = [];

  (sales || []).forEach((row) => {
    const normalizedType = normalizeAdjustmentType(row);
    const isLiability = (row.chart_account?.account_type || '').toLowerCase() === 'liability';
    const itemNameType = getPassThroughTypeFromItemName(row.item_name);
    
    // Item is pass-through if:
    // 1. item_type/adjustment_type is a pass-through type (tax, tip, service_charge, etc.)
    // 2. It's categorized with a liability account
    // 3. item_name contains pass-through keywords (e.g., "Sales Tax", "Credit Tip")
    if (PASS_THROUGH_TYPES.has(normalizedType) || isLiability || itemNameType !== null) {
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
