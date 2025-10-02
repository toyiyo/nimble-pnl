import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useRecipes } from '@/hooks/useRecipes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { RecipeDialog } from '@/components/RecipeDialog';
import { DeleteRecipeDialog } from '@/components/DeleteRecipeDialog';
import { RecipeSuggestions } from '@/components/RecipeSuggestions';
import { AutoDeductionSettings } from '@/components/AutoDeductionSettings';
import { BulkInventoryDeductionDialog } from '@/components/BulkInventoryDeductionDialog';
import { useAutomaticInventoryDeduction } from '@/hooks/useAutomaticInventoryDeduction';
import { useUnifiedSales } from '@/hooks/useUnifiedSales';
import { ChefHat, Plus, Search, Edit, Trash2, DollarSign, Clock, Settings } from 'lucide-react';

export default function Recipes() {
  const { user } = useAuth();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { recipes, loading, fetchRecipes } = useRecipes(selectedRestaurant?.restaurant_id || null);
  const { unmappedItems } = useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<any>(null);
  const [deletingRecipe, setDeletingRecipe] = useState<any>(null);
  const [showAutoSettings, setShowAutoSettings] = useState(false);

  const { setupAutoDeduction } = useAutomaticInventoryDeduction();

  const handleRestaurantSelect = (restaurant: any) => {
    console.log('Selected restaurant object:', restaurant);
    setSelectedRestaurant(restaurant);
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please log in to access recipes.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-2">Recipes</h1>
          <p className="text-muted-foreground">
            Create and manage recipes for your menu items
          </p>
        </div>
        <RestaurantSelector
          restaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          loading={restaurantsLoading}
          createRestaurant={createRestaurant}
        />
      </div>
    );
  }

  const filteredRecipes = recipes.filter(recipe =>
    recipe.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    recipe.pos_item_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const unmappedRecipes = filteredRecipes.filter(recipe => !recipe.pos_item_name);
  const mappedRecipes = filteredRecipes.filter(recipe => recipe.pos_item_name);

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="text-center lg:text-left">
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Recipes</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Create and manage recipes for {selectedRestaurant.restaurant?.name}
          </p>
        </div>
        <div className="flex justify-center lg:justify-start gap-2">
          <BulkInventoryDeductionDialog />
          <Button 
            variant="outline" 
            onClick={() => setShowAutoSettings(!showAutoSettings)}
            size="sm"
          >
            <Settings className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Auto Deduction</span>
            <span className="sm:hidden">Auto</span>
          </Button>
          <Button onClick={() => setIsCreateDialogOpen(true)} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-2" />
            <span className="hidden sm:inline">Create Recipe</span>
            <span className="sm:hidden">New Recipe</span>
          </Button>
        </div>
      </div>

      {/* Auto Deduction Settings */}
      {showAutoSettings && (
        <AutoDeductionSettings />
      )}

      {/* Recipe Suggestions */}
      {unmappedItems.length > 0 && (
        <RecipeSuggestions
          unmappedItems={unmappedItems}
          restaurantId={selectedRestaurant?.restaurant_id}
          onRecipeCreated={fetchRecipes}
        />
      )}
      
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
        <Input
          placeholder="Search recipes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 h-auto md:h-10">
          <TabsTrigger value="all" className="flex flex-col md:flex-row items-center gap-1">
            <span className="text-xs md:text-sm">All Recipes</span>
            <span className="text-xs">({filteredRecipes.length})</span>
          </TabsTrigger>
          <TabsTrigger value="mapped" className="flex flex-col md:flex-row items-center gap-1">
            <span className="text-xs md:text-sm">Mapped to POS</span>
            <span className="text-xs">({mappedRecipes.length})</span>
          </TabsTrigger>
          <TabsTrigger value="unmapped" className="flex flex-col md:flex-row items-center gap-1">
            <span className="text-xs md:text-sm">Unmapped</span>
            <div className="flex items-center gap-1">
              <span className="text-xs">({unmappedRecipes.length})</span>
              {unmappedRecipes.length > 0 && (
                <Badge variant="secondary" className="text-xs h-4 px-1 ml-1">
                  {unmappedRecipes.length}
                </Badge>
              )}
            </div>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <RecipeTable
            recipes={filteredRecipes}
            loading={loading}
            onEdit={setEditingRecipe}
            onDelete={setDeletingRecipe}
          />
        </TabsContent>

        <TabsContent value="mapped">
          <RecipeTable
            recipes={mappedRecipes}
            loading={loading}
            onEdit={setEditingRecipe}
            onDelete={setDeletingRecipe}
          />
        </TabsContent>

        <TabsContent value="unmapped">
          <RecipeTable
            recipes={unmappedRecipes}
            loading={loading}
            onEdit={setEditingRecipe}
            onDelete={setDeletingRecipe}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <RecipeDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        restaurantId={selectedRestaurant?.restaurant_id}
        onRecipeUpdated={fetchRecipes}
      />

      <RecipeDialog
        isOpen={!!editingRecipe}
        onClose={() => setEditingRecipe(null)}
        restaurantId={selectedRestaurant?.restaurant_id}
        recipe={editingRecipe}
        onRecipeUpdated={fetchRecipes}
      />

      <DeleteRecipeDialog
        isOpen={!!deletingRecipe}
        onClose={() => setDeletingRecipe(null)}
        recipe={deletingRecipe}
      />
    </div>
  );
}

interface RecipeTableProps {
  recipes: any[];
  loading: boolean;
  onEdit: (recipe: any) => void;
  onDelete: (recipe: any) => void;
}

function RecipeTable({ recipes, loading, onEdit, onDelete }: RecipeTableProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (recipes.length === 0) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="text-center">
            <ChefHat className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No recipes found</h3>
            <p className="text-muted-foreground">
              Create your first recipe to get started.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Mobile-friendly cards for small screens */}
        <div className="block md:hidden">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="p-4 border-b last:border-b-0">
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{recipe.name}</h3>
                    {recipe.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{recipe.description}</p>
                    )}
                  </div>
                  <div className="flex gap-1 ml-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(recipe)} className="h-8 w-8 p-0">
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDelete(recipe)} className="h-8 w-8 p-0">
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
                
                <div className="flex flex-wrap gap-2">
                  {recipe.pos_item_name ? (
                    <Badge variant="secondary" className="text-xs">{recipe.pos_item_name}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs">Not mapped</Badge>
                  )}
                  <Badge variant="outline" className="text-xs">Size: {recipe.serving_size || 1}</Badge>
                  <Badge variant="outline" className="text-xs">Cost: ${recipe.estimated_cost?.toFixed(2) || '0.00'}</Badge>
                  {recipe.avg_sale_price && (
                    <>
                      <Badge variant="outline" className="text-xs">Sale: ${recipe.avg_sale_price.toFixed(2)}</Badge>
                      <Badge 
                        variant={recipe.profit_margin && recipe.profit_margin > 0 ? "default" : "destructive"} 
                        className="text-xs"
                      >
                        {recipe.profit_margin ? `${recipe.profit_margin.toFixed(1)}%` : 'No profit data'}
                      </Badge>
                    </>
                  )}
                </div>
                
                <div className="text-xs text-muted-foreground">
                  {new Date(recipe.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table for larger screens */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe Name</TableHead>
                <TableHead>POS Item</TableHead>
                <TableHead>Serving Size</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Avg Sale Price</TableHead>
                <TableHead>Profit</TableHead>
                <TableHead>Margin %</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipes.map((recipe) => (
                <TableRow key={recipe.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium">{recipe.name}</div>
                      {recipe.description && (
                        <div className="text-sm text-muted-foreground">
                          {recipe.description}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {recipe.pos_item_name ? (
                      <Badge variant="secondary">{recipe.pos_item_name}</Badge>
                    ) : (
                      <Badge variant="outline">Not mapped</Badge>
                    )}
                  </TableCell>
                  <TableCell>{recipe.serving_size || 1}</TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <DollarSign className="w-4 h-4 mr-1" />
                      ${recipe.estimated_cost?.toFixed(2) || '0.00'}
                    </div>
                  </TableCell>
                  <TableCell>
                    {recipe.avg_sale_price ? (
                      <div className="flex items-center">
                        <DollarSign className="w-4 h-4 mr-1" />
                        ${recipe.avg_sale_price.toFixed(2)}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">No sales data</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {recipe.profit_per_serving !== undefined ? (
                      <div className={`flex items-center ${recipe.profit_per_serving > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        <DollarSign className="w-4 h-4 mr-1" />
                        {recipe.profit_per_serving > 0 ? '+' : ''}${recipe.profit_per_serving.toFixed(2)}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {recipe.profit_margin !== undefined ? (
                      <Badge variant={recipe.profit_margin > 0 ? "default" : "destructive"}>
                        {recipe.profit_margin.toFixed(1)}%
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Clock className="w-4 h-4 mr-1" />
                      {new Date(recipe.created_at).toLocaleDateString()}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(recipe)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDelete(recipe)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}