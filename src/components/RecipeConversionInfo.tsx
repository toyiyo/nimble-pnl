import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Product } from '@/hooks/useProducts';
import { useUnitConversion } from '@/hooks/useUnitConversion';
import { Calculator, TrendingUp, Edit2 } from 'lucide-react';
import { useState } from 'react';

interface RecipeConversionInfoProps {
  product: Product;
  recipeQuantity: number;
  recipeUnit: string;
}

export function RecipeConversionInfo({ product, recipeQuantity, recipeUnit }: RecipeConversionInfoProps) {
  const [isEditing, setIsEditing] = useState(false);
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

  // Calculate costs based on conversion factor
  const actualFactor = isEditing ? customFactor : (product.conversion_factor || 1);
  const costPerRecipeUnit = product.cost_per_unit / actualFactor;
  const totalRecipeCost = recipeQuantity * costPerRecipeUnit;
  const purchaseUnitsNeeded = recipeQuantity / actualFactor;
  
  const handleSaveConversion = async () => {
    try {
      await updateProductConversion(product.id, customFactor);
      setIsEditing(false);
    } catch (error) {
      console.error('Failed to save conversion:', error);
    }
  };
  
  const handleCancelEdit = () => {
    setCustomFactor(product.conversion_factor || 1);
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
            <span className="text-muted-foreground">Conversion Factor:</span>
            {isEditing ? (
              <div className="flex items-center gap-2">
                <span className="text-xs">1 {product.uom_purchase || 'unit'} =</span>
                <Input 
                  type="number"
                  value={customFactor}
                  onChange={(e) => setCustomFactor(parseFloat(e.target.value) || 1)}
                  className="w-20 h-7 text-xs"
                  step="0.001"
                />
                <span className="text-xs">{product.uom_recipe || recipeUnit}</span>
                <Button size="sm" onClick={handleSaveConversion} disabled={loading} className="h-7 px-2">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="h-7 px-2">
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="font-medium">
                  1 {product.uom_purchase || 'unit'} = {actualFactor} {product.uom_recipe || recipeUnit}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} className="h-6 w-6 p-0">
                  <Edit2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per {product.uom_purchase || 'purchase unit'}:</span>
            <span className="font-medium">${product.cost_per_unit.toFixed(2)}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per {product.uom_recipe || recipeUnit}:</span>
            <span className="font-medium">${costPerRecipeUnit.toFixed(3)}</span>
          </div>
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
            <span>Purchase Units Needed:</span>
            <span className="font-medium">{purchaseUnitsNeeded.toFixed(3)} {product.uom_purchase || 'unit'}</span>
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