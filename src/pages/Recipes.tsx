import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurants } from '@/hooks/useRestaurants';
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
import { useUnifiedSales } from '@/hooks/useUnifiedSales';
import { ChefHat, Plus, Search, Edit, Trash2, DollarSign, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Recipes() {
  const { user } = useAuth();
  const { restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurants();
  const [selectedRestaurant, setSelectedRestaurant] = useState<any>(null);
  const { recipes, loading, fetchRecipes } = useRecipes(selectedRestaurant?.restaurant_id || selectedRestaurant?.id || null);
  const { unmappedItems } = useUnifiedSales(selectedRestaurant?.restaurant_id || selectedRestaurant?.id || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<any>(null);
  const [deletingRecipe, setDeletingRecipe] = useState<any>(null);

  const handleRestaurantSelect = (restaurant: any) => {
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
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
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
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold mb-2">Recipes</h1>
          <p className="text-muted-foreground">
            Create and manage recipes for {selectedRestaurant.name || selectedRestaurant.restaurant?.name}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="outline">Back to Dashboard</Button>
          </Link>
          <Button onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Recipe
          </Button>
        </div>
      </div>

      {/* Restaurant Selector */}
      <div className="mb-6">
        <RestaurantSelector
          restaurants={restaurants}
          selectedRestaurant={selectedRestaurant}
          onSelectRestaurant={handleRestaurantSelect}
          loading={restaurantsLoading}
          createRestaurant={createRestaurant}
        />
      </div>

      {/* Search */}
      {unmappedItems.length > 0 && (
        <div className="mb-6">
          <RecipeSuggestions
            unmappedItems={unmappedItems}
            restaurantId={selectedRestaurant?.restaurant_id || selectedRestaurant?.id}
            onRecipeCreated={fetchRecipes}
          />
        </div>
      )}
      
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search recipes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">
            All Recipes ({filteredRecipes.length})
          </TabsTrigger>
          <TabsTrigger value="mapped">
            Mapped to POS ({mappedRecipes.length})
          </TabsTrigger>
          <TabsTrigger value="unmapped">
            Unmapped ({unmappedRecipes.length})
            {unmappedRecipes.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {unmappedRecipes.length}
              </Badge>
            )}
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
        restaurantId={selectedRestaurant?.restaurant_id || selectedRestaurant?.id}
      />

      <RecipeDialog
        isOpen={!!editingRecipe}
        onClose={() => setEditingRecipe(null)}
        restaurantId={selectedRestaurant?.restaurant_id || selectedRestaurant?.id}
        recipe={editingRecipe}
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Recipe Name</TableHead>
              <TableHead>POS Item</TableHead>
              <TableHead>Serving Size</TableHead>
              <TableHead>Estimated Cost</TableHead>
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
      </CardContent>
    </Card>
  );
}