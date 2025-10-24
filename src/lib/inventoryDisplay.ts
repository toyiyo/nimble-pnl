import { convertUnits, getProductUnitInfo } from './enhancedUnitConversion';

/**
 * Convert from purchase units to display units (size_unit)
 * Example: 0.4 boxes → 2 gallons
 */
export function convertPurchaseToDisplay(
  purchaseAmount: number,
  product: {
    uom_purchase?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
  }
): { value: number; unit: string } | null {
  if (!product.size_value || !product.size_unit) {
    return null; // No conversion available
  }
  
  const displayValue = purchaseAmount * product.size_value;
  return {
    value: displayValue,
    unit: product.size_unit
  };
}

/**
 * Convert from display units (size_unit) to purchase units
 * Example: 2 gallons → 0.4 boxes
 */
export function convertDisplayToPurchase(
  displayAmount: number,
  product: {
    uom_purchase?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
  }
): number {
  if (!product.size_value || product.size_value === 0) {
    return displayAmount; // 1:1 if no size info
  }
  
  return displayAmount / product.size_value;
}

/**
 * Format inventory level for display
 * Shows both user-friendly and purchase units
 */
export function formatInventoryLevel(
  purchaseAmount: number,
  product: {
    uom_purchase?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
  },
  options?: {
    showBothUnits?: boolean;
    primaryUnit?: 'display' | 'purchase';
  }
): string {
  const opts = {
    showBothUnits: true,
    primaryUnit: 'display' as const,
    ...options
  };
  
  const displayConversion = convertPurchaseToDisplay(purchaseAmount, product);
  const purchaseUnit = product.uom_purchase || 'units';
  
  // If no conversion available, show purchase units only
  if (!displayConversion) {
    return `${purchaseAmount.toFixed(2)} ${purchaseUnit}`;
  }
  
  // Primary display unit
  if (opts.primaryUnit === 'display') {
    if (opts.showBothUnits) {
      return `${displayConversion.value.toFixed(2)} ${displayConversion.unit} (${purchaseAmount.toFixed(2)} ${purchaseUnit})`;
    }
    return `${displayConversion.value.toFixed(2)} ${displayConversion.unit}`;
  }
  
  // Primary purchase unit
  if (opts.showBothUnits) {
    return `${purchaseAmount.toFixed(2)} ${purchaseUnit} (${displayConversion.value.toFixed(2)} ${displayConversion.unit})`;
  }
  return `${purchaseAmount.toFixed(2)} ${purchaseUnit}`;
}

/**
 * Validate that a display amount is reasonable
 */
export function validateInventoryLevel(
  displayAmount: number,
  product: {
    size_value?: number | null;
    size_unit?: string | null;
  }
): { valid: boolean; message?: string } {
  if (displayAmount < 0) {
    return { valid: false, message: 'Amount cannot be negative' };
  }
  
  if (displayAmount > 100000) {
    return { valid: false, message: 'Amount seems unusually large' };
  }
  
  return { valid: true };
}
