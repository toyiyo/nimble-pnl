// Common unit conversion helper functions
import { VOLUME_UNITS, WEIGHT_UNITS, COUNT_UNITS } from './enhancedUnitConversion';

export type MeasurementCategory = 'volume' | 'weight' | 'count' | 'length' | 'unknown';

// Helper to determine the category of a unit
export function getUnitCategory(unit: string): MeasurementCategory {
  // Extended volume units (includes variations like 'l' for 'L', 'gallon', 'quart', 'pint', 'floz')
  const volumeUnits = [...VOLUME_UNITS, 'l', 'gallon', 'quart', 'pint', 'floz'];
  // Extended weight units (includes 'mg' variation)
  const weightUnits = [...WEIGHT_UNITS, 'mg'];
  const countUnits = COUNT_UNITS;
  const lengthUnits = ['inch', 'cm', 'mm', 'ft', 'meter'];
  
  const normalizedUnit = unit.toLowerCase().trim();

  // Check each category
  if (volumeUnits.some(u => normalizedUnit.includes(u))) return 'volume';
  if (weightUnits.some(u => normalizedUnit.includes(u))) return 'weight';
  if (countUnits.some(u => normalizedUnit.includes(u))) return 'count';
  if (lengthUnits.some(u => normalizedUnit.includes(u))) return 'length';
  
  return 'unknown';
}

// Normalize unit names for consistency
export function normalizeUnitName(unit: string): string {
  const mapping: Record<string, string> = {
    // Volume
    'ounce': 'oz',
    'fluid ounce': 'fl oz',
    'fl oz': 'fl oz',
    'fluid oz': 'fl oz',
    'milliliter': 'ml',
    'millilitre': 'ml',
    'cups': 'cup',
    'tablespoon': 'tbsp',
    'tablespoons': 'tbsp',
    'teaspoon': 'tsp',
    'teaspoons': 'tsp',
    
    // Weight
    'lbs': 'lb',  // Common variation
    'pound': 'lb',
    'pounds': 'lb',
    'gram': 'g',
    'grams': 'g',
    'kilogram': 'kg',
    'kilograms': 'kg',
    
    // Count
    'ea': 'each',
    'pc': 'piece',
    'pcs': 'piece',
    'pieces': 'piece',
    'servings': 'serving',
    'bottles': 'bottle',
    'cans': 'can',
    'boxes': 'box',
    'bags': 'bag',
    'cases': 'case',
    'containers': 'container',
    'packages': 'package',
    'pack': 'package',
    'packs': 'package'
  };
  
  const normalizedUnit = unit.toLowerCase().trim();
  return mapping[normalizedUnit] || normalizedUnit;
}

// Suggest appropriate recipe units based on purchase unit
export function suggestRecipeUnits(purchaseUnit: string): string[] {
  const category = getUnitCategory(purchaseUnit);
  
  switch (category) {
    case 'volume':
      return ['fl oz', 'ml', 'cup', 'tbsp', 'tsp'];
    case 'weight':
      return ['lb', 'oz', 'g'];
    case 'count':
      return ['each', 'piece', 'serving'];
    case 'length':
      return ['inch', 'cm'];
    default:
      return ['each', 'piece'];
  }
}
