import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calculator } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { calculateInventoryImpact } from '@/lib/enhancedUnitConversion';

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
  const purchaseQuantity = product.size_value || 1;
  const purchaseUnit = product.uom_purchase || 'unit';
  const costPerUnit = product.cost_per_unit || 0;

  // Use enhanced unit conversion for accurate calculations
  let conversionResult = null;
  try {
    conversionResult = calculateInventoryImpact(
      recipeQuantity,
      recipeUnit,
      purchaseQuantity,
      purchaseUnit,
      product.name || '',
      costPerUnit
    );
  } catch (error) {
    console.warn('Enhanced conversion failed:', error);
    return (
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <div className="text-sm text-muted-foreground">
            Unable to calculate conversion between {recipeUnit} and {purchaseUnit} for {product.name}.
            Please check the units are compatible.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!conversionResult) {
    return null;
  }

  const { inventoryDeduction, costImpact, percentageOfPackage, conversionDetails } = conversionResult;

  return (
    <Card className="bg-muted/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Conversion Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Package Information */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <span className="text-xs font-medium text-muted-foreground">Purchase Unit</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {purchaseQuantity} {purchaseUnit}
              </Badge>
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground">Recipe Unit</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {recipeQuantity} {recipeUnit}
              </Badge>
            </div>
          </div>
        </div>

        {/* Cost Information */}
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-xs font-medium text-muted-foreground">Package Size</span>
            <div className="font-medium">{purchaseQuantity} {purchaseUnit}</div>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground">Cost per Unit</span>
            <div className="font-medium">${costPerUnit.toFixed(2)}/{purchaseUnit}</div>
          </div>
          <div>
            <span className="text-xs font-medium text-muted-foreground">Total Package Cost</span>
            <div className="font-medium">${(purchaseQuantity * costPerUnit).toFixed(2)}</div>
          </div>
        </div>

        {/* Recipe Cost Calculation */}
        <div className="border-t pt-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-xs font-medium text-muted-foreground">Cost per Recipe Unit</span>
              <div className="font-medium">${(costImpact / recipeQuantity).toFixed(3)}/{recipeUnit}</div>
            </div>
            <div>
              <span className="text-xs font-medium text-muted-foreground">Total Recipe Cost</span>
              <div className="font-medium text-primary">${costImpact.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Enhanced Conversion Details */}
        {conversionDetails && (
          <div className="bg-primary/5 rounded-lg p-3">
            <div className="text-xs font-medium mb-2 flex items-center gap-1">
              <Badge variant="secondary" className="text-xs">Enhanced Conversion</Badge>
              {conversionDetails.productSpecific && (
                <Badge variant="outline" className="text-xs">Product-Specific</Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Conversion: {recipeQuantity} {recipeUnit} = {inventoryDeduction.toFixed(3)} {purchaseUnit}</div>
              {conversionDetails.conversionPath && (
                <div>Path: {conversionDetails.conversionPath.join(' → ')}</div>
              )}
            </div>
          </div>
        )}

        {/* Recipe Impact Summary */}
        <div className="bg-muted/30 rounded-lg p-3">
          <h4 className="text-xs font-medium mb-2">Recipe Impact</h4>
          <div className="grid grid-cols-1 gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Recipe Quantity:</span>
              <span className="font-medium">{recipeQuantity} {recipeUnit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Inventory Deduction:</span>
              <span className="font-medium">{inventoryDeduction.toFixed(3)} {purchaseUnit}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Percentage of Package:</span>
              <span className="font-medium">{percentageOfPackage.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Total Cost:</span>
              <span className="font-medium text-primary">${costImpact.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}