// Enhanced unit conversion system for recipe calculations

export interface ConversionResult {
  value: number;
  fromUnit: string;
  toUnit: string;
  conversionPath?: string[];
  productSpecific?: boolean;
}

// Standard unit conversions (weight and volume)
const STANDARD_CONVERSIONS: { [key: string]: { [key: string]: number } } = {
  // Weight conversions (all to grams)
  'oz': { 'g': 28.3495, 'lb': 1/16, 'kg': 0.0283495 },
  'lb': { 'g': 453.592, 'oz': 16, 'kg': 0.453592 },
  'kg': { 'g': 1000, 'lb': 2.20462, 'oz': 35.274 },
  'g': { 'kg': 0.001, 'oz': 0.035274, 'lb': 0.00220462 },
  
  // Volume conversions (all to ml)
  'cup': { 'ml': 236.588, 'oz': 8, 'tbsp': 16, 'tsp': 48, 'L': 0.236588 },
  'tbsp': { 'ml': 14.7868, 'oz': 0.5, 'cup': 1/16, 'tsp': 3 },
  'tsp': { 'ml': 4.92892, 'oz': 1/6, 'tbsp': 1/3, 'cup': 1/48 },
  'ml': { 'L': 0.001, 'cup': 1/236.588, 'tbsp': 1/14.7868, 'tsp': 1/4.92892 },
  'L': { 'ml': 1000, 'cup': 1/0.236588, 'gal': 1/3.78541 },
  'gal': { 'L': 3.78541, 'qt': 4, 'cup': 16 },
  'qt': { 'gal': 0.25, 'cup': 4, 'L': 0.946353 },
};

// Product-specific conversions (ingredient name -> unit conversions)
const PRODUCT_SPECIFIC_CONVERSIONS: { [key: string]: { [key: string]: number } } = {
  'rice': {
    'cup_to_g': 180,      // 1 cup uncooked rice = 180g
    'cup_to_oz': 6.3,     // 1 cup uncooked rice = 6.3 oz weight
    'g_to_cup': 1/180,    // reverse conversion
    'oz_to_cup': 1/6.3,   // reverse conversion
  },
  'flour': {
    'cup_to_g': 120,      // 1 cup all-purpose flour = 120g
    'cup_to_oz': 4.23,    // 1 cup flour = 4.23 oz weight
    'g_to_cup': 1/120,
    'oz_to_cup': 1/4.23,
  },
  'sugar': {
    'cup_to_g': 200,      // 1 cup granulated sugar = 200g
    'cup_to_oz': 7.05,    // 1 cup sugar = 7.05 oz weight  
    'g_to_cup': 1/200,
    'oz_to_cup': 1/7.05,
  },
  'brown_sugar': {
    'cup_to_g': 213,      // 1 cup packed brown sugar = 213g
    'cup_to_oz': 7.5,     // 1 cup brown sugar = 7.5 oz weight
    'g_to_cup': 1/213,
    'oz_to_cup': 1/7.5,
  },
  'butter': {
    'cup_to_g': 227,      // 1 cup butter = 227g
    'cup_to_oz': 8,       // 1 cup butter = 8 oz weight
    'tbsp_to_g': 14.2,    // 1 tbsp butter = 14.2g
    'g_to_cup': 1/227,
    'oz_to_cup': 1/8,
  }
};

/**
 * Detect product type from product name
 */
export function detectProductType(productName: string): string | null {
  const name = productName.toLowerCase();
  
  if (name.includes('rice')) return 'rice';
  if (name.includes('flour')) return 'flour'; 
  if (name.includes('sugar')) {
    if (name.includes('brown')) return 'brown_sugar';
    return 'sugar';
  }
  if (name.includes('butter')) return 'butter';
  
  return null;
}

/**
 * Convert between units with product-specific intelligence
 */
export function convertUnits(
  value: number, 
  fromUnit: string, 
  toUnit: string, 
  productName?: string
): ConversionResult | null {
  
  if (fromUnit === toUnit) {
    return { value, fromUnit, toUnit };
  }

  // Try product-specific conversion first
  if (productName) {
    const productType = detectProductType(productName);
    if (productType && PRODUCT_SPECIFIC_CONVERSIONS[productType]) {
      const conversions = PRODUCT_SPECIFIC_CONVERSIONS[productType];
      const conversionKey = `${fromUnit}_to_${toUnit}`;
      
      if (conversions[conversionKey]) {
        return {
          value: value * conversions[conversionKey],
          fromUnit,
          toUnit,
          productSpecific: true,
          conversionPath: [productType, conversionKey]
        };
      }
      
      // Try reverse conversion
      const reverseKey = `${toUnit}_to_${fromUnit}`;
      if (conversions[reverseKey]) {
        return {
          value: value / conversions[reverseKey],
          fromUnit,
          toUnit,
          productSpecific: true,
          conversionPath: [productType, `reverse_${reverseKey}`]
        };
      }
    }
  }

  // Standard unit conversion
  if (STANDARD_CONVERSIONS[fromUnit]?.[toUnit]) {
    return {
      value: value * STANDARD_CONVERSIONS[fromUnit][toUnit],
      fromUnit,
      toUnit,
      productSpecific: false
    };
  }

  // Try multi-step conversion through common base units
  // For weight: convert through grams
  // For volume: convert through ml
  
  const weightUnits = ['oz', 'lb', 'kg', 'g'];
  const volumeUnits = ['cup', 'tbsp', 'tsp', 'ml', 'L', 'gal', 'qt'];
  
  if (weightUnits.includes(fromUnit) && weightUnits.includes(toUnit)) {
    // Convert through grams
    const toGrams = STANDARD_CONVERSIONS[fromUnit]?.['g'];
    const fromGrams = STANDARD_CONVERSIONS['g']?.[toUnit];
    
    if (toGrams && fromGrams) {
      return {
        value: value * toGrams * fromGrams,
        fromUnit,
        toUnit,
        conversionPath: [fromUnit, 'g', toUnit]
      };
    }
  }
  
  if (volumeUnits.includes(fromUnit) && volumeUnits.includes(toUnit)) {
    // Convert through ml
    const toMl = STANDARD_CONVERSIONS[fromUnit]?.['ml'];
    const fromMl = STANDARD_CONVERSIONS['ml']?.[toUnit];
    
    if (toMl && fromMl) {
      return {
        value: value * toMl * fromMl,
        fromUnit,
        toUnit,
        conversionPath: [fromUnit, 'ml', toUnit]
      };
    }
  }

  return null; // No conversion found
}

/**
 * Calculate inventory impact for recipe usage
 * This is the core function for your rice example
 */
export function calculateInventoryImpact(
  recipeQuantity: number,
  recipeUnit: string,
  purchaseQuantity: number,
  purchaseUnit: string,
  productName: string,
  costPerPurchaseUnit: number
): {
  inventoryDeduction: number;           // How much to deduct from inventory (in purchase units)
  inventoryDeductionUnit: string;       // Unit of the deduction
  costImpact: number;                   // Cost of this recipe portion
  percentageOfPackage: number;          // What % of purchase unit is used
  conversionDetails: ConversionResult | null;
} {
  
  // For your rice example:
  // recipeQuantity = 1, recipeUnit = 'cup'
  // purchaseQuantity = 80, purchaseUnit = 'oz'  
  // productName = 'Mahatma Jasmine Rice'
  // costPerPurchaseUnit = 5.98
  
  // Step 1: Convert recipe unit to weight (using product-specific conversion)
  const recipeToWeight = convertUnits(recipeQuantity, recipeUnit, 'oz', productName);
  
  if (!recipeToWeight) {
    // Fallback to standard conversion if no product-specific conversion
    const standardConversion = convertUnits(recipeQuantity, recipeUnit, purchaseUnit);
    if (!standardConversion) {
      throw new Error(`Cannot convert ${recipeUnit} to ${purchaseUnit}`);
    }
    
    const inventoryDeduction = standardConversion.value;
    const percentageOfPackage = (inventoryDeduction / purchaseQuantity) * 100;
    const costImpact = (inventoryDeduction / purchaseQuantity) * costPerPurchaseUnit;
    
    return {
      inventoryDeduction,
      inventoryDeductionUnit: purchaseUnit,
      costImpact,
      percentageOfPackage,
      conversionDetails: standardConversion
    };
  }
  
  // For rice: 1 cup = 6.3 oz (weight)
  const recipeWeightInOz = recipeToWeight.value;
  
  // Step 2: Calculate what fraction of the purchase unit this represents
  // For rice: 6.3 oz / 80 oz = 0.07875 (7.875% of the bag)
  const fractionOfPurchase = recipeWeightInOz / purchaseQuantity;
  const percentageOfPackage = fractionOfPurchase * 100;
  
  // Step 3: Calculate cost impact
  // For rice: 0.07875 * $5.98 = $0.47
  const costImpact = fractionOfPurchase * costPerPurchaseUnit;
  
  // Step 4: Determine inventory deduction amount
  // We deduct the equivalent weight in the purchase unit
  // For rice: deduct 6.3 oz from the 80 oz bag
  const inventoryDeduction = recipeWeightInOz;
  
  return {
    inventoryDeduction,
    inventoryDeductionUnit: 'oz',  // We always deduct in weight units for accuracy
    costImpact,
    percentageOfPackage,
    conversionDetails: recipeToWeight
  };
}

/**
 * Calculate how many recipe portions a purchase unit contains
 */
export function calculateRecipePortions(
  purchaseQuantity: number,
  purchaseUnit: string,
  recipeQuantity: number,
  recipeUnit: string,
  productName: string
): {
  totalPortions: number;
  costPerPortion: number;
  conversionDetails: ConversionResult | null;
} {
  
  // For rice example: how many 1-cup portions in an 80 oz bag?
  const recipeToWeight = convertUnits(recipeQuantity, recipeUnit, 'oz', productName);
  
  if (!recipeToWeight) {
    throw new Error(`Cannot convert recipe unit ${recipeUnit} to weight for ${productName}`);
  }
  
  // Rice: 1 cup = 6.3 oz, so 80 oz bag = 80/6.3 = 12.7 cups
  const totalPortions = purchaseQuantity / recipeToWeight.value;
  const costPerPortion = 0; // Will be calculated elsewhere with actual cost
  
  return {
    totalPortions,
    costPerPortion,
    conversionDetails: recipeToWeight
  };
}