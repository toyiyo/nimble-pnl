import { PrepRecipe } from '@/hooks/usePrepRecipes';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, ChefHat, Clock, Edit, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecipeConversionStatusBadge } from '@/components/RecipeConversionStatusBadge';

interface PrepRecipeCardProps {
  recipe: PrepRecipe;
  costPerBatch?: number;
  costPerUnit?: number;
  onEdit?: () => void;
  conversionStatus?: { hasIssues: boolean; issueCount: number };
}

export function PrepRecipeCard({ recipe, costPerBatch = 0, costPerUnit = 0, onEdit, conversionStatus }: Readonly<PrepRecipeCardProps>) {
  const ingredientCount = recipe.ingredients?.length || 0;
  const hasNoIngredients = ingredientCount === 0;
  const stockDisplay = recipe.output_product?.current_stock ?? null;
  const stockUnit = recipe.output_product?.uom_purchase || recipe.default_yield_unit;

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
              {conversionStatus && (
                <RecipeConversionStatusBadge
                  hasIssues={conversionStatus.hasIssues}
                  issueCount={conversionStatus.issueCount}
                  size="sm"
                  showText={true}
                />
              )}
              {hasNoIngredients && (
                <Badge
                  variant="outline"
                  className="rounded-full bg-amber-50 text-amber-700 border-amber-300"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  No ingredients
                </Badge>
              )}
              <Badge
                variant="outline"
                className="rounded-full gap-1"
                aria-label={`Cost $${costPerBatch.toFixed(2)} per batch, $${costPerUnit.toFixed(2)} per ${recipe.default_yield_unit}`}
              >
                <span className="text-muted-foreground">Cost</span>
                <span className="font-medium text-foreground tabular-nums">${costPerBatch.toFixed(2)}</span>
                <span className="text-muted-foreground">/ batch ·</span>
                <span className="font-medium text-foreground tabular-nums">${costPerUnit.toFixed(2)}</span>
                <span className="text-muted-foreground">/ {recipe.default_yield_unit}</span>
              </Badge>
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
