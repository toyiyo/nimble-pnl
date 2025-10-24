// Centralized unit definitions for recipes and ingredients
// Single source of truth for measurement units across the application

export const MEASUREMENT_UNITS = [
  'oz', 'fl oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 
  'bottle', 'can', 'bag', 'box', 'piece', 'serving'
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
