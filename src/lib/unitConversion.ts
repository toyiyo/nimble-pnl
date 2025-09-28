// Common unit conversion helper functions

export type MeasurementCategory = 'volume' | 'weight' | 'count' | 'length' | 'unknown';

// Helper to determine the category of a unit
export function getUnitCategory(unit: string): MeasurementCategory {
  const volumeUnits = ['oz', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'gallon', 'quart', 'pint', 'floz'];
  const weightUnits = ['lb', 'g', 'kg', 'mg', 'oz'];
  const countUnits = ['each', 'piece', 'serving', 'unit', 'bottle', 'can', 'box', 'bag', 'case', 'container', 'package'];
  const lengthUnits = ['inch', 'cm', 'mm', 'ft', 'meter'];
  
  const normalizedUnit = unit.toLowerCase().trim();
  
  // Handle special cases first with exact matches
  if (normalizedUnit === 'oz') {
    // Default to volume for ambiguous "oz"
    return 'volume';
  }
  
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
    'fluid ounce': 'oz',
    'fl oz': 'oz',
    'fluid oz': 'oz',
    'milliliter': 'ml',
    'millilitre': 'ml',
    'cups': 'cup',
    'tablespoon': 'tbsp',
    'tablespoons': 'tbsp',
    'teaspoon': 'tsp',
    'teaspoons': 'tsp',
    
    // Weight
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
      return ['oz', 'ml', 'cup', 'tbsp', 'tsp'];
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