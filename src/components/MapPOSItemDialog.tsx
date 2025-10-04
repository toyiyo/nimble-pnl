import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRecipes } from '@/hooks/useRecipes';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface MapPOSItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  posItemName: string;
  onMappingComplete?: () => void;
}

export const MapPOSItemDialog: React.FC<MapPOSItemDialogProps> = ({
  open,
  onOpenChange,
  restaurantId,
  posItemName,
  onMappingComplete,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { recipes, loading } = useRecipes(restaurantId);
  const [searchTerm, setSearchTerm] = useState('');
  const [isMapping, setIsMapping] = useState(false);

  const filteredRecipes = recipes.filter(recipe =>
    recipe.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleMapToRecipe = async (recipeId: string, recipeName: string) => {
    setIsMapping(true);
    try {
      const { error } = await supabase
        .from('recipes')
        .update({ pos_item_name: posItemName })
        .eq('id', recipeId)
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      toast({
        title: "Mapping successful",
        description: `"${posItemName}" has been mapped to "${recipeName}"`,
      });

      onMappingComplete?.();
      onOpenChange(false);
    } catch (error) {
      console.error('Error mapping POS item:', error);
      toast({
        title: "Error",
        description: "Failed to map POS item to recipe",
        variant: "destructive",
      });
    } finally {
      setIsMapping(false);
    }
  };

  const handleCreateNewRecipe = () => {
    onOpenChange(false);
    navigate('/recipes', { state: { createRecipeFor: posItemName } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Map POS Item to Recipe</DialogTitle>
          <DialogDescription>
            Select an existing recipe to map "{posItemName}" to, or create a new recipe.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search recipes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-2">
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading recipes...
              </div>
            ) : filteredRecipes.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {searchTerm ? 'No recipes match your search' : 'No recipes found'}
              </div>
            ) : (
              filteredRecipes.map((recipe) => (
                <Card
                  key={recipe.id}
                  className="hover:border-primary cursor-pointer transition-colors"
                  onClick={() => !isMapping && handleMapToRecipe(recipe.id, recipe.name)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium">{recipe.name}</h3>
                        {recipe.description && (
                          <p className="text-sm text-muted-foreground line-clamp-1">
                            {recipe.description}
                          </p>
                        )}
                        <div className="flex gap-2 mt-2">
                          {recipe.pos_item_name && (
                            <Badge variant="outline" className="text-xs">
                              Current: {recipe.pos_item_name}
                            </Badge>
                          )}
                          {recipe.estimated_cost !== null && (
                            <Badge variant="secondary" className="text-xs">
                              Cost: ${recipe.estimated_cost.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isMapping}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMapToRecipe(recipe.id, recipe.name);
                        }}
                      >
                        Map Here
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="border-t pt-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleCreateNewRecipe}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create New Recipe for "{posItemName}"
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
