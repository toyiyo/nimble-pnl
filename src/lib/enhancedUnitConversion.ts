// Enhanced unit conversion system for recipe calculations

// Exported unit constants to avoid duplication across the codebase
export const WEIGHT_UNITS = ['lb', 'kg', 'g'];
export const VOLUME_UNITS = ['oz', 'cup', 'tbsp', 'tsp', 'ml', 'L', 'gal', 'qt'];
export const COUNT_UNITS = ['each', 'piece', 'serving', 'unit', 'bottle', 'can', 'box', 'bag', 'case', 'container', 'package', 'dozen'];

export interface ProductUnitInfo {
  packageType: string;
  isContainerUnit: boolean;
  sizeValue: number;
  sizeUnit: string;
  purchaseUnit: string;
  packageQuantity: number;
}

/**
 * Extracts and validates product unit information for container/package calculations.
 * Handles container units (bottle, can, etc.) vs direct measurement units.
 * 
 * @param product - The product object containing unit and size information
 * @returns ProductUnitInfo with validated unit details
 */
export function getProductUnitInfo(product: {
  uom_purchase?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  name?: string;
}): ProductUnitInfo {
  const packageType = product.uom_purchase || 'unit';
  const isContainerUnit = COUNT_UNITS.includes(packageType.toLowerCase());
  
  let sizeValue = product.size_value;
  let sizeUnit = product.size_unit;
  
  // Validate size_value and size_unit for container units
  if (isContainerUnit) {
    if (!sizeValue || !sizeUnit) {
      console.warn(
        `Container unit "${packageType}" for product "${product.name}" is missing size_value or size_unit. Using defaults.`
      );
      sizeValue = sizeValue || 1;
      sizeUnit = sizeUnit || packageType;
    }
  }
  
  // Use container unit (bottle) for purchase, or measurement unit for direct measurements
  // For non-container units: prioritize actual purchase unit, then size_unit, then fallback to 'unit'
  const purchaseUnit = isContainerUnit 
    ? packageType 
    : (product.uom_purchase || sizeUnit || 'unit');
  const packageQuantity = sizeValue || 1;
  
  return {
    packageType,
    isContainerUnit,
    sizeValue: sizeValue || 1,
    sizeUnit: sizeUnit || packageType,
    purchaseUnit,
    packageQuantity,
  };
}

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
  
  if (WEIGHT_UNITS.includes(fromUnit) && WEIGHT_UNITS.includes(toUnit)) {
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
  
  if (VOLUME_UNITS.includes(fromUnit) && VOLUME_UNITS.includes(toUnit)) {
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
  if (COUNT_UNITS.includes(fromUnit) && COUNT_UNITS.includes(toUnit)) {
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
  costPerPackage: number,  // This is cost per package (e.g., $10 per bottle)
  productSizeValue?: number, // Size of container (e.g., 750 for 750ml bottle)
  productSizeUnit?: string   // Unit of container size (e.g., 'ml')
): {
  inventoryDeduction: number;           // How much to deduct from inventory (in purchase units)
  inventoryDeductionUnit: string;       // Unit of the deduction
  costImpact: number;                   // Cost of this recipe portion
  percentageOfPackage: number;          // What % of purchase unit is used
  conversionDetails: ConversionResult | null;
} {
  
  // Step 1: Handle container unit conversions (bottle, can, etc.)
  if (COUNT_UNITS.includes(purchaseUnit) && VOLUME_UNITS.includes(recipeUnit)) {
    // Recipe is in volume (e.g., oz), purchase is in containers (e.g., bottle)
    // Need product size info to convert
    if (!productSizeValue || !productSizeUnit) {
      throw new Error(`Cannot convert ${recipeUnit} to ${purchaseUnit} for ${productName}. Container size information (size_value and size_unit) is required.`);
    }
    
    // Convert recipe quantity to the same unit as product size
    const recipeInSizeUnit = convertUnits(recipeQuantity, recipeUnit, productSizeUnit, productName);
    if (!recipeInSizeUnit) {
      throw new Error(`Cannot convert ${recipeUnit} to ${productSizeUnit} for ${productName}.`);
    }
    
    // Calculate how many containers needed
    const containersNeeded = recipeInSizeUnit.value / productSizeValue;
    
    return {
      inventoryDeduction: containersNeeded,
      inventoryDeductionUnit: purchaseUnit,
      costImpact: containersNeeded * costPerPackage,
      percentageOfPackage: containersNeeded * 100,
      conversionDetails: {
        value: containersNeeded,
        fromUnit: recipeUnit,
        toUnit: purchaseUnit,
        productSpecific: true,
        conversionPath: [recipeUnit, productSizeUnit, purchaseUnit]
      }
    };
  }
  
  // Step 2: Handle bottle unit conversion (legacy support)
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
  
  // If both units are the same, simple division
  if (recipeUnit === purchaseUnit) {
    return {
      totalPortions: purchaseQuantity / recipeQuantity,
      costPerPortion: 0,
      conversionDetails: {
        value: recipeQuantity,
        fromUnit: recipeUnit,
        toUnit: purchaseUnit,
        productSpecific: false
      }
    };
  }
  
  // If recipe unit is a container unit, we can't calculate portions without size info
  if (COUNT_UNITS.includes(recipeUnit.toLowerCase())) {
    // Return 1:1 ratio for container units
    return {
      totalPortions: purchaseQuantity / recipeQuantity,
      costPerPortion: 0,
      conversionDetails: {
        value: recipeQuantity,
        fromUnit: recipeUnit,
        toUnit: purchaseUnit,
        productSpecific: false,
        conversionPath: ['container', 'units']
      }
    };
  }
  
  // Try to convert recipe unit to purchase unit
  const recipeToWeight = convertUnits(recipeQuantity, recipeUnit, purchaseUnit, productName);
  
  if (!recipeToWeight) {
    // If direct conversion fails, try common conversions
    // For liquids, try converting through oz
    if (!COUNT_UNITS.includes(purchaseUnit.toLowerCase())) {
      const recipeToOz = convertUnits(recipeQuantity, recipeUnit, 'oz', productName);
      if (recipeToOz) {
        const purchaseToOz = convertUnits(purchaseQuantity, purchaseUnit, 'oz', productName);
        if (purchaseToOz) {
          const totalPortions = purchaseToOz.value / recipeToOz.value;
          return {
            totalPortions,
            costPerPortion: 0,
            conversionDetails: {
              value: recipeToOz.value,
              fromUnit: recipeUnit,
              toUnit: 'oz',
              conversionPath: [recipeUnit, 'oz', purchaseUnit]
            }
          };
        }
      }
    }
    
    // Last resort: return 1:1
    return {
      totalPortions: purchaseQuantity / recipeQuantity,
      costPerPortion: 0,
      conversionDetails: null
    };
  }
  
  const totalPortions = purchaseQuantity / recipeToWeight.value;
  const costPerPortion = 0;
  
  return {
    totalPortions,
    costPerPortion,
    conversionDetails: recipeToWeight
  };
}