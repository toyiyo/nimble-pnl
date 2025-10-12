import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChefHat } from 'lucide-react';
import { useProductRecipes } from '@/hooks/useProductRecipes';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';
import { RecipeConversionStatusBadge } from '@/components/RecipeConversionStatusBadge';

interface ProductRecipeUsageProps {
  productId: string;
  restaurantId: string;
  products: any[];
}

export function ProductRecipeUsage({ productId, restaurantId, products }: ProductRecipeUsageProps) {
  const { recipes, loading } = useProductRecipes(productId, restaurantId);

  const recipeValidations = useMemo(() => {
    return recipes.map(recipeIngredient => {
      // Create a properly typed ingredient for validation
      const ingredient = {
        product_id: productId,
        quantity: recipeIngredient.quantity,
        unit: recipeIngredient.unit
      };
      return {
        recipe: recipeIngredient.recipe,
        validation: validateRecipeConversions([ingredient], products)
      };
    });
  }, [recipes, products, productId]);

  if (loading) {
    return (
      <div className="text-xs text-muted-foreground">
        Loading recipe usage...
      </div>
    );
  }

  if (recipes.length === 0) {
    return null;
  }

  const hasConversionIssues = recipeValidations.some(rv => rv.validation.hasIssues);

  return (
    <Alert variant={hasConversionIssues ? "default" : "default"} className="mt-3 py-2 px-3">
      <div className="flex items-start gap-2">
        <ChefHat className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0 space-y-1">
          <AlertDescription className="text-xs">
            <div className="font-medium mb-1">Used in {recipes.length} recipe{recipes.length !== 1 ? 's' : ''}:</div>
            <div className="space-y-1">
              {recipeValidations.map(({ recipe, validation }, idx) => (
                <div key={idx} className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">{recipe.name}</span>
                  {recipe.pos_item_name && (
                    <Badge variant="outline" className="text-xs">
                      {recipe.pos_item_name}
                    </Badge>
                  )}
                  <RecipeConversionStatusBadge
                    hasIssues={validation.hasIssues}
                    issueCount={validation.issueCount}
                    size="sm"
                    showText={false}
                  />
                </div>
              ))}
            </div>
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
