import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePrepRecipes, PrepRecipe } from '@/hooks/usePrepRecipes';
import { UserRestaurant } from '@/hooks/useRestaurants';
import { useProducts, Product } from '@/hooks/useProducts';
import { PageHeader } from '@/components/PageHeader';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PrepRecipeDialog, PrepRecipeFormValues } from '@/components/prep/PrepRecipeDialog';
import { PrepRecipeCard } from '@/components/prep/PrepRecipeCard';
import { ProductUpdateSheet } from '@/components/ProductUpdateDialog';
import { ChefHat, Plus, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';

export default function PrepRecipes() {
  const { user } = useAuth();
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
    canCreateRestaurant,
  } = useRestaurantContext();

  const { prepRecipes, loading, error, createPrepRecipe, updatePrepRecipe, recipeStats } = usePrepRecipes(
    selectedRestaurant?.restaurant_id || null
  );
  const { products, updateProductWithQuantity } = useProducts(selectedRestaurant?.restaurant_id || null);

  const [searchTerm, setSearchTerm] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<PrepRecipe | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const filteredRecipes = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return prepRecipes.filter(
      (recipe) =>
        recipe.name.toLowerCase().includes(term) ||
        recipe.description?.toLowerCase().includes(term) ||
        recipe.output_product?.name?.toLowerCase().includes(term)
    );
  }, [prepRecipes, searchTerm]);

  const recipeValidations = useMemo(() => {
    const map = new Map<string, { hasIssues: boolean; issueCount: number }>();
    prepRecipes.forEach((recipe) => {
      const validation = validateRecipeConversions(recipe.ingredients || [], products);
      map.set(recipe.id, { hasIssues: validation.hasIssues, issueCount: validation.issueCount });
    });
    return map;
  }, [prepRecipes, products]);

  const handleRestaurantSelect = (restaurant: UserRestaurant) => {
    setSelectedRestaurant(restaurant);
  };

  const handleSaveRecipe = async (values: PrepRecipeFormValues) => {
    if (!selectedRestaurant) return;

    try {
      if (editingRecipe) {
        await updatePrepRecipe({
          id: editingRecipe.id,
          restaurant_id: selectedRestaurant.restaurant_id,
          ...values,
        });
        setEditingRecipe(null);
      } else {
        await createPrepRecipe({
          restaurant_id: selectedRestaurant.restaurant_id,
          ...values,
        });
      }
      setDialogOpen(false);
    } catch (error) {
      // Consider showing a toast notification to the user
      console.error('Failed to save recipe:', error);
    }
  };

  const handleInventoryUpdate = async (updates: Partial<Product>, _quantityToAdd: number) => {
    if (!editingProduct) return;
    const currentStock = editingProduct.current_stock || 0;
    const finalStock = updates.current_stock ?? currentStock;
    await updateProductWithQuantity(
      editingProduct.id,
      updates,
      currentStock,
      finalStock,
      'adjustment',
      'Inventory update from prep recipes'
    );
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md bg-gradient-to-br from-destructive/5 via-destructive/10 to-transparent border-destructive/20">
          <CardContent className="p-6 text-center space-y-2">
            <ChefHat className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-lg font-semibold">Access Denied</p>
            <p className="text-muted-foreground text-sm">Please log in to access prep recipes.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (restaurantsLoading) {
    return (
      <div className="space-y-6 p-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6 p-4">
        <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
          <ChefHat className="h-8 w-8 text-primary mx-auto mb-3" />
          <h1 className="text-2xl font-bold mb-2">Prep Recipes</h1>
          <p className="text-muted-foreground mb-6">Pick a restaurant to manage prep blueprints.</p>
          <RestaurantSelector
            restaurants={restaurants}
            selectedRestaurant={selectedRestaurant}
            onSelectRestaurant={handleRestaurantSelect}
            loading={restaurantsLoading}
            canCreateRestaurant={canCreateRestaurant}
            createRestaurant={createRestaurant}
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md bg-gradient-to-br from-destructive/5 via-destructive/10 to-transparent border-destructive/20">
          <CardContent className="p-6 text-center space-y-2">
            <ChefHat className="h-8 w-8 text-destructive mx-auto" />
            <p className="text-lg font-semibold">Failed to Load Prep Recipes</p>
            <p className="text-muted-foreground text-sm">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        icon={ChefHat}
        iconVariant="amber"
        title="Prep Recipes"
        restaurantName={selectedRestaurant.restaurant?.name}
        subtitle="Blueprints that turn raw inventory into prep items"
        actions={
          <Button onClick={() => setDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" /> New recipe
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search prep recipes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Badge variant="secondary">{filteredRecipes.length} recipes</Badge>
      </div>

      <div className="space-y-3">
        {filteredRecipes.map((recipe) => (
          <PrepRecipeCard
            key={recipe.id}
            recipe={recipe}
            costPerBatch={recipeStats[recipe.id]?.costPerBatch}
            costPerUnit={recipeStats[recipe.id]?.costPerUnit}
            conversionStatus={recipeValidations.get(recipe.id)}
            onEdit={() => {
              setEditingRecipe(recipe);
              setDialogOpen(true);
            }}
          />
        ))}

        {!loading && filteredRecipes.length === 0 && prepRecipes.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="p-6 text-center space-y-2">
              <p className="font-semibold">No prep recipes yet</p>
              <p className="text-sm text-muted-foreground">
                Create your first prep recipe to start tracking batches and variance.
              </p>
              <Button onClick={() => setDialogOpen(true)} className="mt-2">
                <Plus className="h-4 w-4 mr-2" />
                New prep recipe
              </Button>
            </CardContent>
          </Card>
        )}

        {!loading && filteredRecipes.length === 0 && prepRecipes.length > 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="p-6 text-center space-y-2">
              <p className="font-semibold">No matching recipes</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search term.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <PrepRecipeDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingRecipe(null);
        }}
        onSubmit={handleSaveRecipe}
        products={products}
        editingRecipe={editingRecipe}
        onEditProduct={setEditingProduct}
      />

      {editingProduct && (
        <ProductUpdateSheet
          open={!!editingProduct}
          onOpenChange={(open) => {
            if (!open) setEditingProduct(null);
          }}
          product={editingProduct}
          onUpdate={handleInventoryUpdate}
        />
      )}
    </div>
  );
}
