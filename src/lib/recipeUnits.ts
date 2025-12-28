// Centralized unit definitions for recipes and ingredients
// Single source of truth for measurement units across the application

export const MEASUREMENT_UNITS = [
  // Weight
  'g', 'kg', 'oz', 'lb',
  // Volume
  'ml', 'L', 'fl oz', 'cup', 'tbsp', 'tsp', 'gal', 'qt', 'pint',
  // Count / containers
  'each', 'unit', 'piece', 'serving', 'bottle', 'can', 'bag', 'box', 'case', 'package', 'jar', 'container', 'dozen',
  // Length (used for some packaging)
  'inch', 'cm', 'mm', 'ft', 'meter',
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
