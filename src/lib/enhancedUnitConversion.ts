// Enhanced unit conversion system for recipe calculations

// Exported unit constants to avoid duplication across the codebase
// Note: 'fl oz' is used for fluid ounces (volume) and 'oz' is used for weight ounces
export const WEIGHT_UNITS = ['lb', 'kg', 'g', 'oz'];
export const VOLUME_UNITS = ['fl oz', 'cup', 'tbsp', 'tsp', 'ml', 'L', 'gal', 'qt'];
export const COUNT_UNITS = ['each', 'piece', 'serving', 'unit', 'bottle', 'can', 'box', 'bag', 'case', 'container', 'package', 'dozen', 'jar'];

export interface ProductUnitInfo {
  packageType: string;
  isContainerUnit: boolean;
  sizeValue: number;
  sizeUnit: string;
  purchaseUnit: string;
  quantityPerPurchaseUnit: number; // Size of one purchase unit (e.g., 750ml per bottle)
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
  // For container units: quantityPerPurchaseUnit should be 1 (you buy 1 bottle at a time)
  // For non-container units: use the size_value (e.g., 1000g for a bag)
  const quantityPerPurchaseUnit = isContainerUnit ? 1 : (sizeValue || 1);
  
  return {
    packageType,
    isContainerUnit,
    sizeValue: sizeValue || 1,
    sizeUnit: sizeUnit || packageType,
    purchaseUnit,
    quantityPerPurchaseUnit,
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
  // Note: 'fl oz' for fluid ounces (volume), 'oz' in weight section for weight ounces
  'fl oz': { 'ml': 29.5735, 'L': 0.0295735, 'cup': 0.125, 'tbsp': 2, 'tsp': 6, 'gal': 1/128, 'qt': 1/32 },
  'cup': { 'ml': 236.588, 'fl oz': 8, 'tbsp': 16, 'tsp': 48, 'L': 0.236588 },
  'tbsp': { 'ml': 14.7868, 'fl oz': 0.5, 'cup': 1/16, 'tsp': 3, 'L': 0.0147868 },
  'tsp': { 'ml': 4.92892, 'fl oz': 1/6, 'tbsp': 1/3, 'cup': 1/48, 'L': 0.00492892 },
  'ml': { 'L': 0.001, 'cup': 1/236.588, 'tbsp': 1/14.7868, 'tsp': 1/4.92892, 'fl oz': 1/29.5735 },
  'L': { 'ml': 1000, 'cup': 1/0.236588, 'gal': 1/3.78541, 'fl oz': 33.814, 'tbsp': 67.628, 'tsp': 202.884 },
  'gal': { 'L': 3.78541, 'qt': 4, 'cup': 16, 'fl oz': 128 },
  'qt': { 'gal': 0.25, 'cup': 4, 'L': 0.946353, 'fl oz': 32 },
};

// Product-specific conversions (ingredient name -> unit conversions)
// Exported for use in UI components to show available conversions
export const PRODUCT_CONVERSIONS: { [key: string]: { [key: string]: number } } = {
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
  
  // Normalize units first (handle variations like "lbs" -> "lb")
  const normalizedFromUnit = fromUnit.toLowerCase().trim();
  const normalizedToUnit = toUnit.toLowerCase().trim();
  
  // Handle common variations
  const unitNormalizations: Record<string, string> = {
    'lbs': 'lb',
    'pounds': 'lb',
    'ounces': 'oz',  // Weight ounces
    'fluid ounces': 'fl oz',
    'fluid oz': 'fl oz',
    'floz': 'fl oz',
    'cups': 'cup',
    'tablespoons': 'tbsp',
    'teaspoons': 'tsp',
    'grams': 'g',
    'kilograms': 'kg',
    'l': 'L',  // Normalize lowercase l to uppercase L for liters
    'liters': 'L',
  };
  
  const from = unitNormalizations[normalizedFromUnit] || normalizedFromUnit;
  const to = unitNormalizations[normalizedToUnit] || normalizedToUnit;
  
  if (from === to) {
    return { value, fromUnit: from, toUnit: to };
  }

  // Try product-specific conversion first
  if (productName) {
    const productType = detectProductType(productName);
    if (productType && PRODUCT_CONVERSIONS[productType]) {
      const conversions = PRODUCT_CONVERSIONS[productType];
      const conversionKey = `${from}_to_${to}`;
      
      if (conversions[conversionKey]) {
        return {
          value: value * conversions[conversionKey],
          fromUnit: from,
          toUnit: to,
          productSpecific: true,
          conversionPath: [productType, conversionKey]
        };
      }
      
      // Try reverse conversion
      const reverseKey = `${to}_to_${from}`;
      if (conversions[reverseKey]) {
        return {
          value: value / conversions[reverseKey],
          fromUnit: from,
          toUnit: to,
          productSpecific: true,
          conversionPath: [productType, `reverse_${reverseKey}`]
        };
      }
      
      // Try multi-step product-specific conversion through intermediate units
      // For example: cup -> g -> lb for flour
      if (VOLUME_UNITS.includes(from) && WEIGHT_UNITS.includes(to)) {
        // Try volume -> g -> weight
        const volumeToG = conversions[`${from}_to_g`];
        const gToWeight = STANDARD_CONVERSIONS['g']?.[to];
        
        if (volumeToG && gToWeight) {
          return {
            value: value * volumeToG * gToWeight,
            fromUnit: from,
            toUnit: to,
            productSpecific: true,
            conversionPath: [from, 'g', to, `product:${productType}`]
          };
        }
        
        // Try volume -> oz -> weight
        const volumeToOz = conversions[`${from}_to_oz`];
        const ozToWeight = STANDARD_CONVERSIONS['oz']?.[to];
        
        if (volumeToOz && ozToWeight) {
          return {
            value: value * volumeToOz * ozToWeight,
            fromUnit: from,
            toUnit: to,
            productSpecific: true,
            conversionPath: [from, 'oz', to, `product:${productType}`]
          };
        }
      }
      
      // Reverse: weight -> g -> volume for product-specific items
      if (WEIGHT_UNITS.includes(from) && VOLUME_UNITS.includes(to)) {
        const weightToG = STANDARD_CONVERSIONS[from]?.['g'];
        const gToVolume = conversions[`g_to_${to}`];
        
        if (weightToG && gToVolume) {
          return {
            value: value * weightToG * gToVolume,
            fromUnit: from,
            toUnit: to,
            productSpecific: true,
            conversionPath: [from, 'g', to, `product:${productType}`]
          };
        }
        
        const weightToOz = STANDARD_CONVERSIONS[from]?.['oz'];
        const ozToVolume = conversions[`oz_to_${to}`];
        
        if (weightToOz && ozToVolume) {
          return {
            value: value * weightToOz * ozToVolume,
            fromUnit: from,
            toUnit: to,
            productSpecific: true,
            conversionPath: [from, 'oz', to, `product:${productType}`]
          };
        }
      }
    }
  }

  // Standard unit conversion
  if (STANDARD_CONVERSIONS[from]?.[to]) {
    return {
      value: value * STANDARD_CONVERSIONS[from][to],
      fromUnit: from,
      toUnit: to,
      productSpecific: false
    };
  }

  // Try multi-step conversion through common base units
  // For weight: convert through grams
  // For volume: convert through ml
  
  if (WEIGHT_UNITS.includes(from) && WEIGHT_UNITS.includes(to)) {
    // Convert through grams
    const toGrams = STANDARD_CONVERSIONS[from]?.['g'];
    const fromGrams = STANDARD_CONVERSIONS['g']?.[to];
    
    if (toGrams && fromGrams) {
      return {
        value: value * toGrams * fromGrams,
        fromUnit: from,
        toUnit: to,
        conversionPath: [from, 'g', to]
      };
    }
  }
  
  if (VOLUME_UNITS.includes(from) && VOLUME_UNITS.includes(to)) {
    // Convert through ml
    const toMl = STANDARD_CONVERSIONS[from]?.['ml'];
    const fromMl = STANDARD_CONVERSIONS['ml']?.[to];
    
    if (toMl && fromMl) {
      return {
        value: value * toMl * fromMl,
        fromUnit: from,
        toUnit: to,
        conversionPath: [from, 'ml', to]
      };
    }
  }
  
  // Count-based units convert 1:1 (e.g., bottle -> unit, each -> piece)
  if (COUNT_UNITS.includes(from) && COUNT_UNITS.includes(to)) {
    return {
      value: value, // 1:1 conversion for discrete count units
      fromUnit: from,
      toUnit: to,
      conversionPath: [from, to],
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
  if (COUNT_UNITS.includes(purchaseUnit.toLowerCase()) && 
      (VOLUME_UNITS.includes(recipeUnit.toLowerCase()) || WEIGHT_UNITS.includes(recipeUnit.toLowerCase()))) {
    // Recipe is in volume/weight (e.g., oz, cup, lb), purchase is in containers (e.g., each, bottle)
    // Need product size info to convert
    if (!productSizeValue || !productSizeUnit) {
      throw new Error(`Cannot convert ${recipeUnit} to ${purchaseUnit} for ${productName}. This product needs size information (e.g., "16 oz per each") to calculate costs. Please update the product's size_value and size_unit fields.`);
    }
    
    // Handle fluid ounces for volume-based products
    const sizeUnitLower = productSizeUnit.toLowerCase();
    const recipeUnitLower = recipeUnit.toLowerCase();
    const volumeUnits = ['gal', 'l', 'ml', 'qt', 'pint', 'cup', 'fl oz'];
    
    // If size is in volume units and recipe uses 'fl oz', convert to ml
    if (volumeUnits.includes(sizeUnitLower) && recipeUnitLower === 'fl oz') {
      // Convert recipe amount to ml (1 fl oz = 29.5735 ml)
      const recipeInMl = recipeQuantity * 29.5735;
      
      // Convert product size to ml
      let sizeInMl = productSizeValue;
      if (sizeUnitLower === 'fl oz') sizeInMl = productSizeValue * 29.5735;
      else if (sizeUnitLower === 'l') sizeInMl = productSizeValue * 1000;
      else if (sizeUnitLower === 'gal') sizeInMl = productSizeValue * 3785.41;
      else if (sizeUnitLower === 'qt') sizeInMl = productSizeValue * 946.353;
      else if (sizeUnitLower === 'pint') sizeInMl = productSizeValue * 473.176;
      else if (sizeUnitLower === 'cup') sizeInMl = productSizeValue * 236.588;
      // else ml, already correct
      
      const containersNeeded = recipeInMl / sizeInMl;
      
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
          conversionPath: [`${recipeUnit} (fluid)`, 'ml', productSizeUnit, purchaseUnit]
        }
      };
    }
    
    // Convert recipe quantity to the same unit as product size
    const recipeInSizeUnit = convertUnits(recipeQuantity, recipeUnit, productSizeUnit, productName);
    if (!recipeInSizeUnit) {
      // Determine the appropriate unit type suggestion
      const recipeUnitCategory = VOLUME_UNITS.includes(recipeUnit.toLowerCase()) ? 'volume' : 'weight';
      const suggestedUnits = recipeUnitCategory === 'volume' 
        ? 'fl oz, ml, cup, L' 
        : 'oz, lb, g, kg';
      
      throw new Error(
        `Cannot convert ${recipeUnit} to ${productSizeUnit} for ${productName}. ` +
        `The size_unit "${productSizeUnit}" is not compatible with the recipe unit "${recipeUnit}". ` +
        `For this product, set the size_unit to a ${recipeUnitCategory} unit like: ${suggestedUnits}. ` +
        `Example: "16 oz per ${purchaseUnit}" or "1 lb per ${purchaseUnit}"`
      );
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
    if (recipeUnit === 'fl oz' && purchaseUnit === 'ml') {
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
            conversionPath: ['fl oz', 'ml']
          }
        };
    }
    
    // Try ml to fl oz conversion
    if (recipeUnit === 'ml' && purchaseUnit === 'fl oz') {
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
            conversionPath: ['ml', 'fl oz']
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
    // For liquids, try converting through fl oz
    if (!COUNT_UNITS.includes(purchaseUnit.toLowerCase())) {
      const recipeToFlOz = convertUnits(recipeQuantity, recipeUnit, 'fl oz', productName);
      if (recipeToFlOz) {
        const purchaseToFlOz = convertUnits(purchaseQuantity, purchaseUnit, 'fl oz', productName);
        if (purchaseToFlOz) {
          const totalPortions = purchaseToFlOz.value / recipeToFlOz.value;
          return {
            totalPortions,
            costPerPortion: 0,
            conversionDetails: {
              value: recipeToFlOz.value,
              fromUnit: recipeUnit,
              toUnit: 'fl oz',
              conversionPath: [recipeUnit, 'fl oz', purchaseUnit]
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