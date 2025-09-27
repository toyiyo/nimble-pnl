import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Product } from '@/hooks/useProducts';
import { Calculator, TrendingUp, Package } from 'lucide-react';

interface RecipeConversionInfoProps {
  product: Product;
  recipeQuantity: number;
  recipeUnit: string;
}

export function RecipeConversionInfo({ product, recipeQuantity, recipeUnit }: RecipeConversionInfoProps) {
  if (!product.conversion_factor || !product.cost_per_unit) {
    return null;
  }

  const costPerRecipeUnit = product.cost_per_unit / product.conversion_factor;
  const totalRecipeCost = recipeQuantity * costPerRecipeUnit;
  const purchaseUnitsNeeded = recipeQuantity / product.conversion_factor;

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

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Conversion Factor:</span>
            <span className="font-medium">
              1 {product.uom_purchase} = {product.conversion_factor} {product.uom_recipe}
            </span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per {product.uom_purchase || 'purchase unit'}:</span>
            <span className="font-medium">${product.cost_per_unit.toFixed(2)}</span>
          </div>
          
          <div className="flex justify-between">
            <span className="text-muted-foreground">Cost per {product.uom_recipe || 'recipe unit'}:</span>
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
            <span className="font-medium">{purchaseUnitsNeeded.toFixed(3)} {product.uom_purchase}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Cost:</span>
            <span className="font-medium text-green-600">${totalRecipeCost.toFixed(2)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}