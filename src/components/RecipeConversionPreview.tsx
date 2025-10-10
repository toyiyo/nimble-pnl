import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calculator, TrendingDown, DollarSign, Package } from 'lucide-react';
import { calculateInventoryImpact, calculateRecipePortions } from '@/lib/enhancedUnitConversion';

interface RecipeConversionPreviewProps {
  productName: string;
  purchaseQuantity: number;
  purchaseUnit: string;
  recipeQuantity: number;
  recipeUnit: string;
  costPerUnit?: number;
  recipeName?: string;
  sizeValue?: number;        // Size of package (e.g., 750 for 750ml bottle)
  sizeUnit?: string;         // Unit of package size (e.g., "ml")
  packageQty?: number;       // How many packages
}

export function RecipeConversionPreview({
  productName,
  purchaseQuantity,
  purchaseUnit,
  recipeQuantity,
  recipeUnit,
  costPerUnit = 0,
  recipeName,
  sizeValue,
  sizeUnit,
  packageQty = 1
}: RecipeConversionPreviewProps) {
  
  if (!productName || !purchaseQuantity || !purchaseUnit || !recipeQuantity || !recipeUnit) {
    return null;
  }

  try {
    const impact = calculateInventoryImpact(
      recipeQuantity,
      recipeUnit,
      purchaseQuantity,
      purchaseUnit,
      productName,
      costPerUnit,
      sizeValue,
      sizeUnit
    );

    // For portions calculation, use size info if available
    const portionPurchaseUnit = sizeUnit || purchaseUnit;
    const portionPurchaseQty = sizeValue || purchaseQuantity;
    
    const portions = calculateRecipePortions(
      portionPurchaseQty,
      portionPurchaseUnit,
      1,
      recipeUnit,
      productName
    );

    return (
      <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-blue-800">
            <Calculator className="h-4 w-4" />
            Recipe Conversion Preview
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Conversion Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <Package className="h-3 w-3" />
                <span className="font-medium">Package Size</span>
              </div>
              <Badge variant="outline" className="bg-blue-100 border-blue-300">
                {purchaseQuantity} {purchaseUnit}
              </Badge>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <TrendingDown className="h-3 w-3" />
                <span className="font-medium">Recipe Portions</span>
              </div>
              <Badge variant="outline" className="bg-green-100 border-green-300">
                ~{portions.totalPortions.toFixed(1)} {recipeUnit}s
              </Badge>
            </div>
          </div>

          {/* Detailed Impact */}
          <div className="p-3 bg-white border border-blue-200 rounded-lg">
            <h4 className="text-xs font-medium text-blue-800 mb-2">
              Using {recipeQuantity} {recipeUnit} in a recipe{recipeName ? ` (${recipeName})` : ''}:
            </h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-600">Inventory deduction:</span>
                <span className="font-medium">
                  {impact.inventoryDeduction.toFixed(2)} {impact.inventoryDeductionUnit}
                </span>
              </div>
              
              <div className="flex justify-between">
                <span className="text-gray-600">Percentage of package:</span>
                <span className="font-medium text-orange-600">
                  {impact.percentageOfPackage.toFixed(1)}%
                </span>
              </div>
              
              {costPerUnit > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Cost impact:</span>
                  <span className="font-medium text-green-600 flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    {impact.costImpact.toFixed(2)}
                  </span>
                </div>
              )}
              
              {impact.conversionDetails?.productSpecific && (
                <div className="pt-2 border-t border-gray-200">
                  <Badge variant="secondary" className="text-xs">
                    Product-specific conversion used
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* Example for rice */}
          {productName.toLowerCase().includes('rice') && (
            <div className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
              <p className="text-yellow-800">
                <strong>Rice Example:</strong> This {purchaseQuantity} oz bag contains about {portions.totalPortions.toFixed(1)} cups of uncooked rice.
                Each cup weighs ~{impact.inventoryDeduction.toFixed(1)} oz.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  } catch (error) {
    return (
      <Card className="bg-red-50 border-red-200">
        <CardContent className="p-4">
          <p className="text-sm text-red-600">
            Unable to calculate conversion preview: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </CardContent>
      </Card>
    );
  }
}