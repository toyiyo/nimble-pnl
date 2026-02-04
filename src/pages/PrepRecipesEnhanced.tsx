import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { usePrepRecipes, PrepRecipe } from '@/hooks/usePrepRecipes';
import { UserRestaurant } from '@/hooks/useRestaurants';
import { useProducts, Product } from '@/hooks/useProducts';
import { useQuickCook, QuickCookPreview } from '@/hooks/useQuickCook';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EnhancedPrepRecipeDialog, EnhancedPrepRecipeFormValues } from '@/components/prep/EnhancedPrepRecipeDialog';
import { EnhancedPrepRecipeCard, EnhancedPrepRecipeCardCompact } from '@/components/prep/EnhancedPrepRecipeCard';
import { ProductUpdateSheet } from '@/components/ProductUpdateDialog';
import { QuickCookConfirmDialog } from '@/components/prep/QuickCookConfirmDialog';
import {
  ChefHat,
  Plus,
  Search,
  Grid3X3,
  List,
  Filter,
  BookOpen,
  TrendingUp,
  Package,
  AlertTriangle,
  Sparkles
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Category configuration
const CATEGORIES = [
  { value: 'all', label: 'All Recipes', icon: BookOpen },
  { value: 'prep', label: 'Prep', icon: ChefHat },
  { value: 'sauces', label: 'Sauces', icon: Package },
  { value: 'proteins', label: 'Proteins', icon: ChefHat },
  { value: 'dough', label: 'Dough & Bread', icon: Package },
  { value: 'desserts', label: 'Desserts', icon: Sparkles },
  { value: 'soup', label: 'Soups', icon: Package },
];

export default function PrepRecipesEnhanced() {
  const { user } = useAuth();
  const {
    selectedRestaurant,
    setSelectedRestaurant,
    restaurants,
    loading: restaurantsLoading,
    createRestaurant,
    canCreateRestaurant,
  } = useRestaurantContext();

  const { prepRecipes, loading, error, createPrepRecipe, updatePrepRecipe, recipeStats, fetchPrepRecipes } = usePrepRecipes(
    selectedRestaurant?.restaurant_id || null
  );
  const { products, updateProductWithQuantity } = useProducts(selectedRestaurant?.restaurant_id || null);
  const { previewQuickCook, executeQuickCook, loading: quickCookLoading } = useQuickCook(
    selectedRestaurant?.restaurant_id || null
  );

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<PrepRecipe | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [quickCookPreview, setQuickCookPreview] = useState<QuickCookPreview | null>(null);
  const [quickCookDialogOpen, setQuickCookDialogOpen] = useState(false);

  // Filter recipes by category and search term
  const filteredRecipes = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return prepRecipes.filter((recipe) => {
      // Category filter
      if (selectedCategory !== 'all') {
        const recipeCategory = recipe.category || 'prep';
        if (recipeCategory !== selectedCategory) return false;
      }

      // Search filter
      if (term) {
        return (
          recipe.name.toLowerCase().includes(term) ||
          recipe.description?.toLowerCase().includes(term) ||
          recipe.output_product?.name?.toLowerCase().includes(term)
        );
      }

      return true;
    });
  }, [prepRecipes, searchTerm, selectedCategory]);

  // Validation map
  const recipeValidations = useMemo(() => {
    const map = new Map<string, { hasIssues: boolean; issueCount: number }>();
    prepRecipes.forEach((recipe) => {
      const validation = validateRecipeConversions(recipe.ingredients || [], products);
      map.set(recipe.id, { hasIssues: validation.hasIssues, issueCount: validation.issueCount });
    });
    return map;
  }, [prepRecipes, products]);

  // Stats
  const stats = useMemo(() => {
    const totalRecipes = prepRecipes.length;
    const totalIngredients = prepRecipes.reduce((acc, r) => acc + (r.ingredients?.length || 0), 0);
    const avgCost = totalRecipes > 0
      ? prepRecipes.reduce((acc, r) => acc + (recipeStats[r.id]?.costPerBatch || 0), 0) / totalRecipes
      : 0;
    const recipesWithIssues = Array.from(recipeValidations.values()).filter(v => v.hasIssues).length;

    return { totalRecipes, totalIngredients, avgCost, recipesWithIssues };
  }, [prepRecipes, recipeStats, recipeValidations]);

  const handleRestaurantSelect = (restaurant: UserRestaurant) => {
    setSelectedRestaurant(restaurant);
  };

  const handleSaveRecipe = async (values: EnhancedPrepRecipeFormValues) => {
    if (!selectedRestaurant) return;

    try {
      // Transform the enhanced form values to match the existing API
      const apiValues = {
        name: values.name,
        description: values.description,
        output_product_id: values.output_product_id,
        default_yield: values.default_yield,
        default_yield_unit: values.default_yield_unit,
        prep_time_minutes: values.prep_time_minutes,
        // New enhanced fields
        category: values.category,
        shelf_life_days: values.shelf_life_days,
        storage_instructions: values.storage_instructions,
        oven_temp: values.oven_temp,
        oven_temp_unit: values.oven_temp_unit,
        equipment_notes: values.equipment_notes,
        procedure_steps: values.procedure_steps?.map((step, index) => ({
          step_number: index + 1,
          instruction: step.instruction,
          timer_minutes: step.timer_minutes,
          critical_point: step.critical_point,
        })),
        ingredients: values.ingredients.map((ing) => ({
          id: ing.id,
          product_id: ing.product_id,
          quantity: ing.quantity,
          unit: ing.unit,
          notes: ing.notes,
          sort_order: ing.sort_order,
        })),
      };

      if (editingRecipe) {
        await updatePrepRecipe({
          id: editingRecipe.id,
          restaurant_id: selectedRestaurant.restaurant_id,
          ...apiValues,
        });
        setEditingRecipe(null);
      } else {
        await createPrepRecipe({
          restaurant_id: selectedRestaurant.restaurant_id,
          ...apiValues,
        });
      }
      setDialogOpen(false);
    } catch (error) {
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

  const handleQuickCookClick = async (recipe: PrepRecipe) => {
    const preview = await previewQuickCook(recipe);
    if (preview) {
      setQuickCookPreview(preview);
      setQuickCookDialogOpen(true);
    }
  };

  const handleQuickCookConfirm = async () => {
    if (!quickCookPreview) return;
    const result = await executeQuickCook(quickCookPreview.recipe);
    if (result.success) {
      setQuickCookDialogOpen(false);
      setQuickCookPreview(null);
      fetchPrepRecipes(); // Refresh to show updated stock
    }
  };

  // Loading state
  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-4">
            <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
              <ChefHat className="h-8 w-8 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Access Denied</h2>
              <p className="text-muted-foreground text-sm mt-1">Please log in to access prep recipes.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (restaurantsLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-48 w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-lg">
          <CardContent className="p-8 text-center space-y-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-32 h-32 rounded-full bg-primary/5 animate-pulse" />
              </div>
              <div className="relative p-4 rounded-full bg-gradient-to-br from-primary to-primary/80 w-fit mx-auto shadow-lg">
                <ChefHat className="h-12 w-12 text-primary-foreground" />
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Prep Recipe Library</h1>
              <p className="text-muted-foreground mt-2">
                Select a restaurant to manage standardized prep recipes and batches.
              </p>
            </div>
            <RestaurantSelector
              restaurants={restaurants}
              selectedRestaurant={selectedRestaurant}
              onSelectRestaurant={handleRestaurantSelect}
              loading={restaurantsLoading}
              canCreateRestaurant={canCreateRestaurant}
              createRestaurant={createRestaurant}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md border-destructive/50">
          <CardContent className="p-8 text-center space-y-4">
            <div className="p-4 rounded-full bg-destructive/10 w-fit mx-auto">
              <AlertTriangle className="h-8 w-8 text-destructive" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Failed to Load</h2>
              <p className="text-muted-foreground text-sm mt-1">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-primary/5 via-background to-accent/5 border-b">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative px-6 py-8 md:py-12">
          <div className="max-w-7xl mx-auto">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-xl bg-primary shadow-lg shadow-primary/25">
                    <BookOpen className="h-7 w-7 text-primary-foreground" />
                  </div>
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Prep Recipe Library</h1>
                    <p className="text-muted-foreground">
                      {selectedRestaurant.restaurant?.name}
                    </p>
                  </div>
                </div>
              </div>

              <Button
                size="lg"
                className="gap-2 shadow-lg shadow-primary/25 w-full md:w-auto"
                onClick={() => {
                  setEditingRecipe(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-5 w-5" />
                New Recipe
              </Button>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-8">
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300" style={{ animationDelay: '100ms' }}>
                <Card className="bg-card/50 backdrop-blur border-primary/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-primary/10">
                        <BookOpen className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums">{stats.totalRecipes}</p>
                        <p className="text-xs text-muted-foreground">Total Recipes</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300" style={{ animationDelay: '200ms' }}>
                <Card className="bg-card/50 backdrop-blur border-accent/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-accent/10">
                        <Package className="h-5 w-5 text-accent" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums">{stats.totalIngredients}</p>
                        <p className="text-xs text-muted-foreground">Ingredients Used</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300" style={{ animationDelay: '300ms' }}>
                <Card className="bg-card/50 backdrop-blur border-success/20">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-success/10">
                        <TrendingUp className="h-5 w-5 text-success" />
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums">${stats.avgCost.toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">Avg. Batch Cost</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="animate-in fade-in slide-in-from-bottom-4 duration-300" style={{ animationDelay: '400ms' }}>
                <Card className={cn(
                  "bg-card/50 backdrop-blur",
                  stats.recipesWithIssues > 0 ? "border-amber-300" : "border-muted"
                )}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-2 rounded-lg",
                        stats.recipesWithIssues > 0 ? "bg-amber-100" : "bg-muted"
                      )}>
                        <AlertTriangle className={cn(
                          "h-5 w-5",
                          stats.recipesWithIssues > 0 ? "text-amber-600" : "text-muted-foreground"
                        )} />
                      </div>
                      <div>
                        <p className="text-2xl font-bold tabular-nums">{stats.recipesWithIssues}</p>
                        <p className="text-xs text-muted-foreground">Need Attention</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="px-6 py-6 max-w-7xl mx-auto">
        {/* Toolbar */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-10 h-11 bg-background"
              placeholder="Search recipes by name, description, or output..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Category filter */}
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full md:w-48 h-11">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  <div className="flex items-center gap-2">
                    <cat.icon className="h-4 w-4" />
                    {cat.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View toggle */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'cards' | 'list')} className="hidden md:block">
            <TabsList className="h-11">
              <TabsTrigger value="cards" className="px-3">
                <Grid3X3 className="h-4 w-4" />
              </TabsTrigger>
              <TabsTrigger value="list" className="px-3">
                <List className="h-4 w-4" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">
            {filteredRecipes.length} recipe{filteredRecipes.length !== 1 ? 's' : ''}
            {searchTerm && ` matching "${searchTerm}"`}
          </p>
        </div>

        {/* Recipe grid/list */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : filteredRecipes.length > 0 ? (
          <div
            key={viewMode}
            className="grid gap-4 grid-cols-1 animate-in fade-in duration-200"
          >
            {filteredRecipes.map((recipe, index) => (
              <div
                key={recipe.id}
                className="animate-in fade-in slide-in-from-bottom-4 duration-300"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {viewMode === 'cards' ? (
                  <EnhancedPrepRecipeCard
                    recipe={recipe}
                    costPerBatch={recipeStats[recipe.id]?.costPerBatch}
                    costPerUnit={recipeStats[recipe.id]?.costPerUnit}
                    conversionStatus={recipeValidations.get(recipe.id)}
                    onEdit={() => {
                      setEditingRecipe(recipe);
                      setDialogOpen(true);
                    }}
                    onStartBatch={() => handleQuickCookClick(recipe)}
                  />
                ) : (
                  <EnhancedPrepRecipeCardCompact
                    recipe={recipe}
                    costPerBatch={recipeStats[recipe.id]?.costPerBatch}
                    costPerUnit={recipeStats[recipe.id]?.costPerUnit}
                    conversionStatus={recipeValidations.get(recipe.id)}
                    onEdit={() => {
                      setEditingRecipe(recipe);
                      setDialogOpen(true);
                    }}
                    onStartBatch={() => handleQuickCookClick(recipe)}
                  />
                )}
              </div>
            ))}
          </div>
        ) : prepRecipes.length === 0 ? (
          <Card className="border-dashed border-2">
            <CardContent className="p-12 text-center space-y-4">
              <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto">
                <BookOpen className="h-10 w-10 text-primary" />
              </div>
              <div>
                <h3 className="text-lg font-semibold">Start Your Recipe Library</h3>
                <p className="text-muted-foreground mt-1 max-w-md mx-auto">
                  Create standardized prep recipes to ensure consistency, track costs, and manage batches efficiently.
                </p>
              </div>
              <Button
                size="lg"
                className="gap-2"
                onClick={() => {
                  setEditingRecipe(null);
                  setDialogOpen(true);
                }}
              >
                <Plus className="h-5 w-5" />
                Create First Recipe
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed border-2">
            <CardContent className="p-8 text-center space-y-2">
              <Search className="h-8 w-8 text-muted-foreground mx-auto" />
              <h3 className="font-semibold">No matching recipes</h3>
              <p className="text-sm text-muted-foreground">
                Try adjusting your search or filter criteria.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialog */}
      <EnhancedPrepRecipeDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingRecipe(null);
        }}
        onSubmit={handleSaveRecipe}
        products={products}
        editingRecipe={editingRecipe}
      />

      {/* Product edit sheet */}
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

      {/* Quick cook confirmation dialog */}
      <QuickCookConfirmDialog
        open={quickCookDialogOpen}
        onOpenChange={(open) => {
          setQuickCookDialogOpen(open);
          if (!open) setQuickCookPreview(null);
        }}
        preview={quickCookPreview}
        onConfirm={handleQuickCookConfirm}
        loading={quickCookLoading}
      />
    </div>
  );
}
