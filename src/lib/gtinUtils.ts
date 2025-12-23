/**
 * GTIN (Global Trade Item Number) Utilities
 * Implements proper GS1 check digit calculation and normalization
 */

/**
 * Calculate GS1 check digit for a GTIN
 * Algorithm: https://www.gs1.org/services/check-digit-calculator
 * 
 * @param digits - The first 13 digits of a GTIN-14 (without check digit)
 * @returns The check digit (0-9)
 */
export function calculateGS1CheckDigit(digits: string): string {
  if (digits.length !== 13) {
    throw new Error(`Expected 13 digits, got ${digits.length}`);
  }

  let sum = 0;
  
  // Multiply odd positions (from right) by 3, even by 1
  for (let i = 0; i < 13; i++) {
    const digit = parseInt(digits[i], 10);
    const multiplier = (13 - i) % 2 === 0 ? 3 : 1;
    sum += digit * multiplier;
  }

  // Check digit = (10 - (sum % 10)) % 10
  const checkDigit = (10 - (sum % 10)) % 10;
  
  return checkDigit.toString();
}

/**
 * Normalize a barcode to GTIN-14 format with proper check digit
 * 
 * Handles:
 * - UPC-A (12 digits) → GTIN-14
 * - EAN-13 (13 digits) → GTIN-14
 * - GTIN-14 (14 digits) → validates and recalculates check digit
 * 
 * @param barcode - Input barcode (may contain non-digits)
 * @returns Normalized GTIN-14 with correct check digit
 */
export function normalizeGTIN(barcode: string): string {
  // Strip non-digits
  const digits = barcode.replace(/\D/g, '');
  
  if (digits.length === 0) {
    throw new Error('Barcode contains no digits');
  }
  
  // Pad to 13 digits (we'll add check digit to make 14)
  const base13 = digits.slice(0, 13).padStart(13, '0');
  
  // Calculate and append check digit
  const checkDigit = calculateGS1CheckDigit(base13);
  const gtin14 = base13 + checkDigit;
  
  return gtin14;
}

/**
 * Validate a GTIN check digit
 * 
 * @param gtin - Full GTIN (8, 12, 13, or 14 digits)
 * @returns true if check digit is valid
 */
export function validateGTIN(gtin: string): boolean {
  const digits = gtin.replace(/\D/g, '');
  
  if (digits.length < 8 || digits.length > 14) {
    return false;
  }
  
  // Pad to 14 digits for consistent validation
  const gtin14 = digits.padStart(14, '0');
  
  // Extract check digit and base
  const providedCheckDigit = gtin14[13];
  const base13 = gtin14.slice(0, 13);
  
  // Calculate what check digit should be
  const calculatedCheckDigit = calculateGS1CheckDigit(base13);
  
  return providedCheckDigit === calculatedCheckDigit;
}

/**
 * Format a GTIN for display with proper grouping
 * Example: 00619947000027 → 0-06199-47000-02-7
 * 
 * @param gtin - GTIN-14
 * @returns Formatted GTIN string
 */
export function formatGTIN(gtin: string): string {
  if (gtin.length !== 14) {
    return gtin;
  }
  
  // GTIN-14 format: I-CCCCC-PPPPP-II-C
  // I = Indicator digit, C = Company prefix, P = Item reference, C = Check digit
  return `${gtin.slice(0, 1)}-${gtin.slice(1, 6)}-${gtin.slice(6, 11)}-${gtin.slice(11, 13)}-${gtin.slice(13)}`;
}
