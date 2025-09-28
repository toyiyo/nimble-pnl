import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Product } from '@/hooks/useProducts';
import { useUnitConversion } from '@/hooks/useUnitConversion';
import { calculateInventoryImpact } from '@/lib/enhancedUnitConversion';
import { Calculator, TrendingUp, Edit2, Info } from 'lucide-react';
import { useState } from 'react';

interface RecipeConversionInfoProps {
  product: Product;
  recipeQuantity: number;
  recipeUnit: string;
}

export function RecipeConversionInfo({ product, recipeQuantity, recipeUnit }: RecipeConversionInfoProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [savedFactor, setSavedFactor] = useState(product.conversion_factor || 1);
  const [customFactor, setCustomFactor] = useState(product.conversion_factor || 1);
  const { updateProductConversion, loading } = useUnitConversion(product.restaurant_id);
  
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
    console.warn('Enhanced conversion failed, falling back to basic conversion:', error);
  }

  // Fallback to basic conversion if enhanced calculation fails
  const currentFactor = savedFactor !== (product.conversion_factor || 1) ? savedFactor : (product.conversion_factor || 1);
  const actualFactor = isEditing ? customFactor : currentFactor;
  
  let costPerRecipeUnit, totalRecipeCost, purchaseUnitsNeeded, percentageUsed;
  
  if (conversionResult) {
    costPerRecipeUnit = conversionResult.costImpact;
    totalRecipeCost = conversionResult.costImpact;
    purchaseUnitsNeeded = conversionResult.inventoryDeduction;
    percentageUsed = conversionResult.percentageOfPackage;
  } else {
    // Fallback to basic calculation
    costPerRecipeUnit = costPerUnit / actualFactor;
    totalRecipeCost = recipeQuantity * costPerRecipeUnit;
    purchaseUnitsNeeded = recipeQuantity / actualFactor;
    percentageUsed = (purchaseUnitsNeeded / purchaseQuantity) * 100;
  }
  
  const handleSaveConversion = async () => {
    try {
      await updateProductConversion(product.id, customFactor);
      setSavedFactor(customFactor); // Update our saved factor state
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save conversion:', error);
    }
  };
  
  const handleCancelEdit = () => {
    setCustomFactor(currentFactor);
    setIsEditing(false);
  };

  return (
    <Card className="bg-muted/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          Conversion Details
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Purchase Unit</div>
            <Badge variant="outline">
              {product.uom_purchase || 'unit'}
            </Badge>
          </div>
          <div>
            <div className="text-muted-foreground">Recipe Unit</div>
            <Badge variant="outline">
              {product.uom_recipe || recipeUnit}
            </Badge>
          </div>
        </div>

        <Separator />

        <div className="space-y-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Package Size:</span>
            <span className="font-medium">
              {purchaseQuantity} {purchaseUnit}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per package:</span>
            <span className="font-medium">${costPerUnit.toFixed(2)}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per {recipeUnit}:</span>
            <span className="font-medium">${(costPerRecipeUnit / recipeQuantity).toFixed(3)}</span>
          </div>

          {conversionResult && (
            <div className="pt-2 space-y-2 border-t">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Info className="w-3 h-3" />
                Enhanced conversion for {product.name?.toLowerCase().includes('rice') ? 'rice' : 'this product'}
              </div>
              
              {product.name?.toLowerCase().includes('rice') && (
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span>1 cup rice weighs:</span>
                    <span>~6.3 oz / 180g</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Package yields:</span>
                    <span>~{(purchaseQuantity / 6.3).toFixed(1)} cups</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {!conversionResult && isEditing && (
            <div className="flex items-center gap-2 pt-2 border-t">
              <span className="text-xs">1 {purchaseUnit} =</span>
              <Input 
                type="number"
                value={customFactor}
                onChange={(e) => setCustomFactor(parseFloat(e.target.value) || 1)}
                className="w-20 h-7 text-xs"
                step="0.001"
              />
              <span className="text-xs">{recipeUnit}</span>
              <Button size="sm" onClick={handleSaveConversion} disabled={loading} className="h-7 px-2">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="h-7 px-2">
                Cancel
              </Button>
            </div>
          )}

          {!conversionResult && !isEditing && (
            <div className="flex justify-between items-center pt-2 border-t">
              <span className="text-muted-foreground">Manual conversion:</span>
              <div className="flex items-center gap-2">
                <span className="font-medium text-xs">
                  1 {purchaseUnit} = {actualFactor} {recipeUnit}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} className="h-6 w-6 p-0">
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2 text-sm bg-background p-3 rounded-lg">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <TrendingUp className="w-4 h-4" />
            Recipe Impact
          </div>
          <div className="flex justify-between">
            <span>Recipe Quantity:</span>
            <span className="font-medium">{recipeQuantity} {recipeUnit}</span>
          </div>
          <div className="flex justify-between">
            <span>Inventory Deduction:</span>
            <span className="font-medium">{purchaseUnitsNeeded.toFixed(3)} {purchaseUnit}</span>
          </div>
          <div className="flex justify-between">
            <span>Percentage of Package:</span>
            <span className="font-medium">{percentageUsed.toFixed(1)}%</span>
          </div>
          <div className="flex justify-between">
            <span>Total Cost:</span>
            <span className="font-medium text-primary">${totalRecipeCost.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}