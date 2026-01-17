import { PrepRecipe } from '@/hooks/usePrepRecipes';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChefHat, Clock, Edit, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PrepRecipeCardProps {
  recipe: PrepRecipe;
  costPerBatch?: number;
  costPerUnit?: number;
  missingCount?: number;
  onEdit?: () => void;
}

export function PrepRecipeCard({ recipe, costPerBatch = 0, costPerUnit = 0, missingCount = 0, onEdit }: Readonly<PrepRecipeCardProps>) {
  const ingredientCount = recipe.ingredients?.length || 0;
  const stockDisplay = recipe.output_product?.current_stock ?? null;
  const stockUnit = recipe.output_product?.uom_purchase || recipe.default_yield_unit;
  const hasMissing = missingCount > 0;

  return (
    <Card className="hover:shadow-md transition-all duration-200 border-border/70">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="rounded-full">
                <ChefHat className="h-4 w-4 mr-1 text-primary" />
                Prep Blueprint
              </Badge>
              {recipe.prep_time_minutes ? (
                <Badge variant="outline" className="rounded-full">
                  <Clock className="h-3.5 w-3.5 mr-1" />
                  {recipe.prep_time_minutes} min
                </Badge>
              ) : null}
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-lg leading-tight">{recipe.name}</p>
                {recipe.output_product?.name && (
                  <Badge variant="outline" className="rounded-full">
                    Output: {recipe.output_product.name}
                  </Badge>
                )}
              </div>
              {recipe.description && <p className="text-sm text-muted-foreground">{recipe.description}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-primary/10 text-primary border-primary/30">
                Yields {recipe.default_yield} {recipe.default_yield_unit}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {ingredientCount} ingredient{ingredientCount === 1 ? '' : 's'}
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {hasMissing ? `Estimated $${costPerBatch.toFixed(2)}` : `$${costPerBatch.toFixed(2)}`} / batch
              </Badge>
              <Badge variant="outline" className="rounded-full">
                {hasMissing ? `Estimated $${costPerUnit.toFixed(2)}` : `$${costPerUnit.toFixed(2)}`} / {recipe.default_yield_unit}
              </Badge>
              {hasMissing && (
                <Badge variant="outline" className="rounded-full border-amber-300 bg-amber-50 text-amber-700">
                  Missing {missingCount}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-3">
            {onEdit && (
              <Button variant="ghost" size="sm" className="gap-2" onClick={onEdit}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
            )}
            {stockDisplay !== null && (
              <div className="text-right text-sm text-muted-foreground">
                <div className="flex items-center gap-1 justify-end">
                  <Package className="h-4 w-4 text-success" />
                  <span className={cn('font-medium text-success-foreground')}>
                    {stockDisplay} {stockUnit}
                  </span>
                </div>
                <div>In stock</div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
