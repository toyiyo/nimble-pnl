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
  'lb': { 'g': 453.592, 'oz': 16, 'kg': 0.453592 },
  'kg': { 'g': 1000, 'lb': 2.20462, 'oz': 35.274 },
  'g': { 'kg': 0.001, 'oz': 0.035274, 'lb': 0.00220462 },
  
  // Volume conversions (all to ml)
  // Note: 'oz' for liquids (fluid ounces) - placed in volume section to prioritize liquid conversions
  'oz': { 'ml': 29.5735, 'L': 0.0295735, 'cup': 0.125, 'tbsp': 2, 'tsp': 6, 'gal': 1/128, 'qt': 1/32 },
  'cup': { 'ml': 236.588, 'oz': 8, 'tbsp': 16, 'tsp': 48, 'L': 0.236588 },
  'tbsp': { 'ml': 14.7868, 'oz': 0.5, 'cup': 1/16, 'tsp': 3, 'L': 0.0147868 },
  'tsp': { 'ml': 4.92892, 'oz': 1/6, 'tbsp': 1/3, 'cup': 1/48, 'L': 0.00492892 },
  'ml': { 'L': 0.001, 'cup': 1/236.588, 'tbsp': 1/14.7868, 'tsp': 1/4.92892, 'oz': 1/29.5735 },
  'L': { 'ml': 1000, 'cup': 1/0.236588, 'gal': 1/3.78541, 'oz': 33.814, 'tbsp': 67.628, 'tsp': 202.884 },
  'gal': { 'L': 3.78541, 'qt': 4, 'cup': 16, 'oz': 128 },
  'qt': { 'gal': 0.25, 'cup': 4, 'L': 0.946353, 'oz': 32 },
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
  
  const weightUnits = ['lb', 'kg', 'g'];
  const volumeUnits = ['oz', 'cup', 'tbsp', 'tsp', 'ml', 'L', 'gal', 'qt'];
  const countUnits = ['each', 'piece', 'serving', 'unit', 'bottle', 'can', 'box', 'bag', 'case', 'container', 'package', 'dozen'];
  
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
  
  // Count-based units convert 1:1 (e.g., bottle -> unit, each -> piece)
  if (countUnits.includes(fromUnit) && countUnits.includes(toUnit)) {
    return {
      value: value, // 1:1 conversion for discrete count units
      fromUnit,
      toUnit,
      conversionPath: [fromUnit, toUnit],
      productSpecific: false
    };
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
  costPerPackage: number  // This is cost per package (e.g., $10 per bottle)
): {
  inventoryDeduction: number;           // How much to deduct from inventory (in purchase units)
  inventoryDeductionUnit: string;       // Unit of the deduction
  costImpact: number;                   // Cost of this recipe portion
  percentageOfPackage: number;          // What % of purchase unit is used
  conversionDetails: ConversionResult | null;
} {
  
  // Step 1: Handle bottle unit conversion
  if (recipeUnit === 'bottle' && purchaseUnit === 'ml') {
    // If recipe calls for bottles and purchase unit is ml, convert directly
    const inventoryDeduction = recipeQuantity * purchaseQuantity; // e.g., 1 bottle = 750ml
    return {
      inventoryDeduction,
      inventoryDeductionUnit: purchaseUnit,
      costImpact: recipeQuantity * costPerPackage,
      percentageOfPackage: (recipeQuantity * 100),
      conversionDetails: {
        value: inventoryDeduction,
        fromUnit: recipeUnit,
        toUnit: purchaseUnit,
        productSpecific: true,
        conversionPath: ['bottle', 'ml']
      }
    };
  }

  // Step 2: Convert recipe quantity to purchase units for direct comparison
  const recipeConversion = convertUnits(recipeQuantity, recipeUnit, purchaseUnit, productName);
  
  if (!recipeConversion) {
    // If direct conversion fails, try some common conversions
    console.warn(`Direct conversion from ${recipeUnit} to ${purchaseUnit} failed for ${productName}. Attempting fallback conversions.`);
    
    // Try common liquid conversions first
    if (recipeUnit === 'oz' && purchaseUnit === 'ml') {
      // 1 fl oz = 29.5735 ml
        const convertedValue = recipeQuantity * 29.5735;
        return {
          inventoryDeduction: convertedValue,
          inventoryDeductionUnit: purchaseUnit,
          costImpact: (convertedValue / purchaseQuantity) * costPerPackage,
          percentageOfPackage: (convertedValue / purchaseQuantity) * 100,
          conversionDetails: {
            value: convertedValue,
            fromUnit: recipeUnit,
            toUnit: purchaseUnit,
            productSpecific: false,
            conversionPath: ['oz', 'ml']
          }
        };
    }
    
    // Try ml to oz conversion
    if (recipeUnit === 'ml' && purchaseUnit === 'oz') {
        const convertedValue = recipeQuantity / 29.5735;
        return {
          inventoryDeduction: convertedValue,
          inventoryDeductionUnit: purchaseUnit,
          costImpact: (convertedValue / purchaseQuantity) * costPerPackage,
          percentageOfPackage: (convertedValue / purchaseQuantity) * 100,
          conversionDetails: {
            value: convertedValue,
            fromUnit: recipeUnit,
            toUnit: purchaseUnit,
            productSpecific: false,
            conversionPath: ['ml', 'oz']
          }
        };
    }
    
    // If both units are the same, use direct calculation
    if (recipeUnit === purchaseUnit) {
      return {
        inventoryDeduction: recipeQuantity,
        inventoryDeductionUnit: purchaseUnit,
        costImpact: (recipeQuantity / purchaseQuantity) * costPerPackage,
        percentageOfPackage: (recipeQuantity / purchaseQuantity) * 100,
        conversionDetails: {
          value: recipeQuantity,
          fromUnit: recipeUnit,
          toUnit: purchaseUnit,
          productSpecific: false
        }
      };
    }
    
    throw new Error(`Cannot convert ${recipeUnit} to ${purchaseUnit} for ${productName}. Please ensure units are compatible or use the same measurement type.`);
  }
  
  // Step 2: Calculate inventory deduction (how much of the purchase unit we use)
  const inventoryDeduction = recipeConversion.value;
  
  // Step 3: Calculate percentage of total package used
  const percentageOfPackage = (inventoryDeduction / purchaseQuantity) * 100;
  
  // Step 4: Calculate cost impact
  // costPerPackage is per package (e.g., $10 per bottle), so calculate based on percentage used
  const costImpact = (inventoryDeduction / purchaseQuantity) * costPerPackage;
  
  return {
    inventoryDeduction,
    inventoryDeductionUnit: purchaseUnit,
    costImpact,
    percentageOfPackage,
    conversionDetails: recipeConversion
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