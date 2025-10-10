import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calculator, Package } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { calculateInventoryImpact, COUNT_UNITS } from '@/lib/enhancedUnitConversion';

interface RecipeConversionInfoProps {
  product: Product;
  recipeQuantity: number;
  recipeUnit: string;
}

export function RecipeConversionInfo({ product, recipeQuantity, recipeUnit }: RecipeConversionInfoProps) {
  if (!product.cost_per_unit) {
    return (
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">
            No cost information available for this product.
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate enhanced conversions using the enhanced unit conversion system
  const packageType = product.uom_purchase || 'unit'; // What you buy by (bottle, bag, etc.)
  const costPerUnit = product.cost_per_unit || 0; // Cost per package type (per bottle, per bag)
  
  // Determine if purchase unit is a container unit or direct measurement unit
  const isContainerUnit = COUNT_UNITS.includes((packageType || '').toLowerCase());
  
  const purchaseUnit = isContainerUnit ? packageType : (product.size_unit || 'unit');
  const quantityPerPurchaseUnit = product.size_value || 1;
  const productSizeValue = product.size_value;
  const productSizeUnit = product.size_unit;

  // Use enhanced unit conversion for accurate calculations
  let impact = null;
  try {
    impact = calculateInventoryImpact(
      recipeQuantity,
      recipeUnit,
      quantityPerPurchaseUnit,
      purchaseUnit,
      product.name || '',
      costPerUnit,
      productSizeValue,
      productSizeUnit
    );
  } catch (error) {
    console.warn('Enhanced conversion failed:', error);
    return (
      <Card className="bg-red-50 border-red-200">
        <CardContent className="p-4">
          <div className="text-sm text-red-600">
            Unable to calculate conversion between {recipeUnit} and {purchaseUnit} for {product.name}.
            Please check the units are compatible.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!impact) {
    return null;
  }

  const costPerRecipeUnit = impact.costImpact / recipeQuantity;

  return (
    <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-blue-800">
          <Calculator className="w-4 h-4" />
          ✨ Enhanced Conversion Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Package Information */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h4 className="font-semibold text-blue-900 flex items-center gap-2 text-sm">
              <Package className="h-4 w-4" />
              📦 Package Information
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1 border-b border-blue-200">
                <span className="text-blue-700">Purchase Unit</span>
                <span className="font-medium">
                  {quantityPerPurchaseUnit} {purchaseUnit}
                  <span className="text-blue-600 ml-2 text-xs">
                    (per {packageType})
                  </span>
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-blue-200">
                <span className="text-blue-700">Recipe Unit</span>
                <span className="font-medium">{recipeQuantity} {recipeUnit}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-blue-200">
                <span className="text-blue-700">Package Size</span>
                <span className="font-medium">
                  {isContainerUnit 
                    ? `${product.size_value || 0} ${product.size_unit || 'unit'} per ${packageType}`
                    : `${quantityPerPurchaseUnit} ${purchaseUnit} per ${packageType}`
                  }
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-blue-200">
                <span className="text-blue-700">Cost per Package</span>
                <span className="font-medium">${product.cost_per_unit?.toFixed(2) || '0.00'}/{packageType}</span>
              </div>
              <div className="flex justify-between py-1 bg-blue-100 px-2 rounded">
                <span className="text-blue-800 font-medium">Total Package Cost</span>
                <span className="font-bold text-blue-900">
                  ${(product.cost_per_unit || 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between py-1 bg-green-100 px-2 rounded">
                <span className="text-green-800 font-medium">Cost per {purchaseUnit}</span>
                <span className="font-bold text-green-900">
                  ${((product.cost_per_unit || 0) / (product.size_value || 1)).toFixed(4)}/{purchaseUnit}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-green-900 flex items-center gap-2 text-sm">
              <Calculator className="h-4 w-4" />
              🧮 Recipe Impact
            </h4>
            <div className="space-y-2 text-sm">
              <div className="p-3 bg-green-50 rounded">
                <div className="font-medium text-green-800 mb-2">Recipe Quantity:</div>
                <div className="text-lg font-bold text-green-900">
                  {recipeQuantity} {recipeUnit}
                </div>
              </div>
              
              <div className="p-3 bg-orange-50 rounded">
                <div className="font-medium text-orange-800 mb-2">Inventory Deduction:</div>
                <div className="text-lg font-bold text-orange-900">
                  {impact.inventoryDeduction.toFixed(3)} {impact.inventoryDeductionUnit}
                </div>
              </div>
              
              <div className="p-3 bg-blue-50 rounded">
                <div className="font-medium text-blue-800 mb-2">Percentage of Package:</div>
                <div className="text-lg font-bold text-blue-900">
                  {impact.percentageOfPackage.toFixed(1)}%
                </div>
              </div>
              
              <div className="p-3 bg-green-50 rounded">
                <div className="font-medium text-green-800 mb-2">Total Cost:</div>
                <div className="text-lg font-bold text-green-900">
                  ${impact.costImpact.toFixed(2)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Enhanced Conversion */}
        {impact.conversionDetails && (
          <div className="p-4 bg-white border border-blue-200 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="default" className="bg-blue-600">Enhanced Conversion</Badge>
              {impact.conversionDetails.productSpecific && (
                <Badge variant="outline" className="border-green-400 text-green-700">Product-Specific</Badge>
              )}
            </div>
            <div className="text-sm space-y-2">
              <div className="font-medium">
                Conversion: {recipeQuantity} {recipeUnit} = {impact.inventoryDeduction.toFixed(3)} {impact.inventoryDeductionUnit}
              </div>
              {impact.conversionDetails.conversionPath && (
                <div className="text-blue-600">
                  Path: {impact.conversionDetails.conversionPath.join(' → ')}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}