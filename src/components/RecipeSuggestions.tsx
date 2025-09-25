import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lightbulb, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useProducts } from '@/hooks/useProducts';

interface RecipeSuggestionsProps {
  unmappedItems: string[];
  restaurantId: string;
  onRecipeCreated: () => void;
}

interface SuggestedRecipe {
  recipeName: string;
  servingSize: number;
  ingredients: Array<{
    ingredientName: string;
    quantity: number;
    unit: string;
  }>;
  confidence: number;
  reasoning: string;
}

export const RecipeSuggestions: React.FC<RecipeSuggestionsProps> = ({
  unmappedItems,
  restaurantId,
  onRecipeCreated
}) => {
  const [loadingItems, setLoadingItems] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Record<string, SuggestedRecipe>>({});
  const { products } = useProducts(restaurantId);
  const { toast } = useToast();

  const handleGenerateSuggestion = async (itemName: string) => {
    setLoadingItems(prev => new Set(prev).add(itemName));

    try {
      const availableIngredients = products.map(product => ({
        id: product.id,
        name: product.name,
        uom_recipe: product.uom_recipe || 'unit'
      }));

      const { data, error } = await supabase.functions.invoke('grok-recipe-enhance', {
        body: {
          itemName,
          availableIngredients
        }
      });

      if (error) throw error;

      if (data.success && data.recipe) {
        setSuggestions(prev => ({
          ...prev,
          [itemName]: data.recipe
        }));
      } else {
        throw new Error(data.error || 'Failed to generate recipe suggestion');
      }
    } catch (error: any) {
      console.error('Error generating recipe suggestion:', error);
      toast({
        title: "Error generating suggestion",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingItems(prev => {
        const next = new Set(prev);
        next.delete(itemName);
        return next;
      });
    }
  };

  const handleCreateRecipe = async (itemName: string, suggestion: SuggestedRecipe) => {
    try {
      // Create the recipe
      const { data: recipe, error: recipeError } = await supabase
        .from('recipes')
        .insert({
          restaurant_id: restaurantId,
          name: suggestion.recipeName,
          pos_item_name: itemName,
          serving_size: suggestion.servingSize,
          is_active: true
        })
        .select()
        .single();

      if (recipeError) throw recipeError;

      // Add ingredients
      const ingredientsToInsert = suggestion.ingredients
        .map(ingredient => {
          const product = products.find(p => p.name === ingredient.ingredientName);
          if (!product) return null;
          
          return {
            recipe_id: recipe.id,
            product_id: product.id,
            quantity: ingredient.quantity,
            unit: ingredient.unit as any
          };
        })
        .filter(Boolean);

      if (ingredientsToInsert.length > 0) {
        const { error: ingredientsError } = await supabase
          .from('recipe_ingredients')
          .insert(ingredientsToInsert);

        if (ingredientsError) throw ingredientsError;
      }

      toast({
        title: "Recipe created",
        description: `Recipe for ${suggestion.recipeName} has been created successfully.`,
      });

      // Remove from suggestions
      setSuggestions(prev => {
        const next = { ...prev };
        delete next[itemName];
        return next;
      });

      onRecipeCreated();
    } catch (error: any) {
      console.error('Error creating recipe:', error);
      toast({
        title: "Error creating recipe",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  if (unmappedItems.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          Recipe Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          These POS items don't have recipes yet. Use AI to generate recipe suggestions based on your inventory.
        </p>
        
        {unmappedItems.slice(0, 5).map((itemName) => {
          const isLoading = loadingItems.has(itemName);
          const suggestion = suggestions[itemName];
          
          return (
            <div key={itemName} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium">{itemName}</h4>
                {!suggestion && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGenerateSuggestion(itemName)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      'Suggest Recipe'
                    )}
                  </Button>
                )}
              </div>
              
              {suggestion && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant={suggestion.confidence > 0.7 ? 'default' : 'secondary'}>
                      {Math.round(suggestion.confidence * 100)}% confidence
                    </Badge>
                  </div>
                  
                  <div>
                    <h5 className="font-medium mb-1">{suggestion.recipeName}</h5>
                    <p className="text-sm text-muted-foreground mb-2">{suggestion.reasoning}</p>
                    
                    <div className="mb-3">
                      <h6 className="text-sm font-medium mb-1">Ingredients:</h6>
                      <div className="space-y-1">
                        {suggestion.ingredients.map((ingredient, idx) => (
                          <div key={idx} className="text-sm">
                            {ingredient.quantity} {ingredient.unit} of {ingredient.ingredientName}
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleCreateRecipe(itemName, suggestion)}
                        disabled={suggestion.confidence < 0.3}
                      >
                        Create Recipe
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSuggestions(prev => {
                          const next = { ...prev };
                          delete next[itemName];
                          return next;
                        })}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        
        {unmappedItems.length > 5 && (
          <p className="text-sm text-muted-foreground">
            And {unmappedItems.length - 5} more items...
          </p>
        )}
      </CardContent>
    </Card>
  );
};