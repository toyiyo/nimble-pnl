// Centralized unit definitions for recipes and ingredients
// Derives from enhancedUnitConversion.ts as single source of truth
// See docs/UNIT_CONVERSIONS.md for full documentation

import { WEIGHT_UNITS, VOLUME_UNITS, COUNT_UNITS } from './enhancedUnitConversion';

// Length units for packaging measurements (not in enhanced conversion)
const LENGTH_UNITS = ['inch', 'cm', 'mm', 'ft', 'meter'] as const;

// Note: 'pint' is now included in VOLUME_UNITS from enhancedUnitConversion.ts
export const MEASUREMENT_UNITS = [
  ...WEIGHT_UNITS,
  ...VOLUME_UNITS,
  ...COUNT_UNITS,
  ...LENGTH_UNITS,
] as const;

export type IngredientUnit = typeof MEASUREMENT_UNITS[number];

/**
 * Type guard to check if a string is a valid IngredientUnit
 */
export function isValidIngredientUnit(unit: string): unit is IngredientUnit {
  return (MEASUREMENT_UNITS as readonly string[]).includes(unit);
}

/**
 * Safely convert a string to an IngredientUnit, falling back to 'oz' if invalid
 */
export function toIngredientUnit(unit: string): IngredientUnit {
  return isValidIngredientUnit(unit) ? unit : 'oz';
}
