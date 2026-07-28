import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useRecipes } from '@/hooks/useRecipes';
import { useProducts, Product } from '@/hooks/useProducts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RestaurantSelector } from '@/components/RestaurantSelector';
import { RecipeDialog } from '@/components/RecipeDialog';
import { DeleteRecipeDialog } from '@/components/DeleteRecipeDialog';
import { RecipeSuggestions } from '@/components/RecipeSuggestions';
import { AutoDeductionSettings } from '@/components/AutoDeductionSettings';
import { BulkInventoryDeductionDialog } from '@/components/BulkInventoryDeductionDialog';
import { ProductUpdateSheet } from '@/components/ProductUpdateDialog';
import { useAutomaticInventoryDeduction } from '@/hooks/useAutomaticInventoryDeduction';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUnifiedSales } from '@/hooks/useUnifiedSales';
import {
  MemoizedRecipeCard,
  MemoizedRecipeRow,
  type RecipeDisplayValues,
} from '@/components/recipes/MemoizedRecipeRow';
import { RECIPE_COLUMN_WIDTHS, RECIPE_TABLE_MIN_WIDTH } from '@/components/recipes/recipeTableColumns';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';
import { ChefHat, Plus, Search, Settings, ArrowUpDown, AlertTriangle, Sparkles, TrendingUp, CheckCircle2, ChevronDown } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MetricIcon } from '@/components/MetricIcon';
import { PageHeader } from '@/components/PageHeader';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { RecipeCreateFromExistingDialog } from '@/components/RecipeCreateFromExistingDialog';

export default function Recipes() {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant, canCreateRestaurant } = useRestaurantContext();
  const { recipes, loading, isError, fetchRecipes, fetchRecipeIngredients } = useRecipes(selectedRestaurant?.restaurant_id || null);
  const { products, updateProductWithQuantity } = useProducts(selectedRestaurant?.restaurant_id || null);
  const { unmappedItems } = useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<any>(null);
  const [deletingRecipe, setDeletingRecipe] = useState<any>(null);
  const [isFromExistingOpen, setIsFromExistingOpen] = useState(false);
  const [createFromBasePayload, setCreateFromBasePayload] = useState<{
    prefill: any;
    basedOn: { id: string; name: string };
  } | null>(null);
  const [createFromBaseRecipeId, setCreateFromBaseRecipeId] = useState<string | null>(null);
  const [showAutoSettings, setShowAutoSettings] = useState(false);
  const [initialPosItemName, setInitialPosItemName] = useState<string | undefined>();
  const [newProductId, setNewProductId] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'cost' | 'salePrice' | 'margin' | 'created'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showOnlyWarnings, setShowOnlyWarnings] = useState(false);

  const { setupAutoDeduction } = useAutomaticInventoryDeduction();

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
      'Inventory update from recipes'
    );
  };

  // Check if we navigated here with a POS item to create a recipe for
  useEffect(() => {
    if (location.state?.createRecipeFor) {
      setInitialPosItemName(location.state.createRecipeFor);
      setIsCreateDialogOpen(true);
      // Clear the state after using it
      window.history.replaceState({}, document.title);
    }

    // Check query params for create action (e.g., from onboarding)
    if (searchParams.get('action') === 'new') {
      setIsCreateDialogOpen(true);
      // Clear the query param
      searchParams.delete('action');
      setSearchParams(searchParams, { replace: true });
    }
  }, [location.state, searchParams, setSearchParams]);
  
  // Check if we navigated here with a recipe ID to view
  useEffect(() => {
    const recipeIdParam = searchParams.get('recipeId');
    if (recipeIdParam && recipes.length > 0) {
      const recipe = recipes.find(r => r.id === recipeIdParam);
      if (recipe) {
        setEditingRecipe(recipe);
        // Clean up query parameter
        searchParams.delete('recipeId');
        setSearchParams(searchParams, { replace: true });
      }
    }
  }, [searchParams, recipes, setSearchParams]);
  
  // Check if we're returning from creating a new product
  useEffect(() => {
    const newProductIdParam = searchParams.get('newProductId');
    const returnToRecipe = searchParams.get('returnToRecipe');
    
    if (newProductIdParam && returnToRecipe === 'true') {
      setNewProductId(newProductIdParam);
      
      // Restore recipe dialog state from sessionStorage if available
      const recipeStateJson = sessionStorage.getItem('recipeFormState');
      if (recipeStateJson) {
        try {
          const recipeState = JSON.parse(recipeStateJson);
          
          // Check if we were editing an existing recipe
          if (recipeState.isEditing && recipeState.recipeId) {
            const recipe = recipes.find(r => r.id === recipeState.recipeId);
            if (recipe) {
              setEditingRecipe(recipe);
            }
          } else {
            // We were creating a new recipe
            setIsCreateDialogOpen(true);
          }
        } catch (error) {
          console.error('Error restoring recipe state:', error);
        }
      }
      
      // Clean up query parameters
      searchParams.delete('newProductId');
      searchParams.delete('returnToRecipe');
      setSearchParams(searchParams);
    }
  }, [searchParams, setSearchParams, recipes]);

  const handleRestaurantSelect = (restaurant: any) => {
    console.log('Selected restaurant object:', restaurant);
    setSelectedRestaurant(restaurant);
  };

  // Compute filtered recipes and memoized lists before early returns.
  // Memoized: an unmemoized filter here produces a new array on every render
  // (including every keystroke elsewhere on the page), which invalidates the
  // `unmappedRecipes`/`mappedRecipes` memos below and re-sorts and re-validates
  // every recipe in all three RecipeTables.
  const filteredRecipes = useMemo(() => {
    const needle = searchTerm.toLowerCase();
    if (!needle) return recipes;
    return recipes.filter(recipe =>
      recipe.name.toLowerCase().includes(needle) ||
      recipe.pos_item_name?.toLowerCase().includes(needle)
    );
  }, [recipes, searchTerm]);

  const unmappedRecipes = useMemo(() => {
    return filteredRecipes.filter(recipe => !recipe.pos_item_name);
  }, [filteredRecipes]);

  const mappedRecipes = useMemo(() => {
    return filteredRecipes.filter(recipe => recipe.pos_item_name);
  }, [filteredRecipes]);

  // Rows are memoized on callback identity, so an inline arrow here would
  // re-render every visible row on every keystroke elsewhere on the page.
  const handleOpenCreate = useCallback(() => setIsCreateDialogOpen(true), []);
  const handleCreateFromBase = useCallback((recipe: { id: string }) => {
    setCreateFromBaseRecipeId(recipe.id);
    setIsFromExistingOpen(true);
  }, []);

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md bg-gradient-to-br from-destructive/5 via-destructive/10 to-transparent border-destructive/20">
          <CardHeader className="text-center">
            <MetricIcon icon={AlertTriangle} variant="red" className="mx-auto mb-4" />
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>Please log in to access recipes.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (restaurantsLoading) {
    return (
      <div className="space-y-6 p-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-96 w-full" />
        <p className="sr-only">Loading recipe management...</p>
      </div>
    );
  }

  if (!selectedRestaurant) {
    return (
      <div className="space-y-6 p-4">
        <div className="text-center p-8 rounded-lg bg-gradient-to-br from-primary/5 via-accent/5 to-transparent border border-border/50">
          <MetricIcon icon={ChefHat} variant="emerald" className="mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">Recipes</h1>
          <p className="text-muted-foreground mb-6">
            Create and manage recipes for your menu items
          </p>
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

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Enhanced Header */}
      <PageHeader
        icon={ChefHat}
        iconVariant="emerald"
        title="Recipe Management"
        restaurantName={selectedRestaurant.restaurant?.name}
        subtitle={
          <div className="flex items-center gap-2 flex-wrap">
            <span aria-label={`${recipes.length} total recipes`}>{recipes.length} total recipes</span>
            {mappedRecipes.length > 0 && (
              <>
                <span className="hidden sm:inline" aria-hidden="true">•</span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />
                  <span aria-label={`${mappedRecipes.length} recipes mapped to POS`}>{mappedRecipes.length} mapped to POS</span>
                </span>
              </>
            )}
          </div>
        }
        actions={
          <>
            <BulkInventoryDeductionDialog />
            <Button 
              variant="outline" 
              onClick={() => setShowAutoSettings(!showAutoSettings)}
              size="sm"
              className="w-full sm:w-auto group hover:border-primary/50 transition-all duration-200"
              aria-label={showAutoSettings ? "Hide auto deduction settings" : "Show auto deduction settings"}
              aria-expanded={showAutoSettings}
            >
              <Settings className="w-4 h-4 mr-2 group-hover:text-primary transition-colors" aria-hidden="true" />
              <span className="hidden sm:inline">Auto Deduction</span>
              <span className="sm:hidden">Auto</span>
            </Button>
            <DropdownMenu>
              <div className="inline-flex w-full sm:w-auto">
                <Button 
                  onClick={() => {
                    setCreateFromBasePayload(null);
                    setCreateFromBaseRecipeId(null);
                    setIsCreateDialogOpen(true);
                  }}
                  className="w-full sm:w-auto gap-2 group bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary transition-all duration-200 rounded-r-none"
                  aria-label="Create new recipe"
                >
                  <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" aria-hidden="true" />
                  <span className="hidden sm:inline">Create Recipe</span>
                  <span className="sm:hidden">New Recipe</span>
                </Button>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="default"
                    className="rounded-l-none border-l border-primary/30 px-2"
                    aria-label="Recipe create options"
                  >
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </div>
              <DropdownMenuContent align="end" className="bg-background z-50">
                <DropdownMenuItem onClick={() => setIsFromExistingOpen(true)}>
                  From Existing Recipe
                </DropdownMenuItem>
                <DropdownMenuItem disabled>From Template (soon)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

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
      
      {/* Search and Filters */}
      <Card className="p-4 bg-gradient-to-br from-background via-accent/5 to-background border-border/50 shadow-sm hover:shadow-md transition-shadow duration-200">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" aria-hidden="true" />
            <Input
              placeholder="Search recipes by name or POS item..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 border-border/50 focus:border-primary/50 transition-all duration-200 focus:ring-2 focus:ring-primary/20"
              aria-label="Search recipes by name or POS item"
            />
          </div>
          <div className="flex gap-2" role="group" aria-label="Sort and filter options">
            <Select value={sortBy} onValueChange={(value: 'name' | 'cost' | 'salePrice' | 'margin' | 'created') => setSortBy(value)}>
              <SelectTrigger className="w-[160px] border-border/50 hover:border-primary/50 transition-colors" aria-label="Sort recipes by">
                <ArrowUpDown className="w-4 h-4 mr-2" aria-hidden="true" />
                <SelectValue placeholder="Sort by..." />
              </SelectTrigger>
              <SelectContent className="z-50 bg-background">
                <SelectItem value="name">📝 Name</SelectItem>
                <SelectItem value="cost">💰 Cost</SelectItem>
                <SelectItem value="salePrice">💵 Sale Price</SelectItem>
                <SelectItem value="margin">📊 Margin %</SelectItem>
                <SelectItem value="created">📅 Date Created</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              variant={sortDirection === 'asc' ? 'default' : 'outline'} 
              size="icon"
              onClick={() => setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')}
              className="transition-all hover:scale-105 duration-200"
              title={sortDirection === 'asc' ? 'Ascending order' : 'Descending order'}
              aria-label={`Sort direction: ${sortDirection === 'asc' ? 'Ascending' : 'Descending'}`}
              aria-pressed={sortDirection === 'asc'}
            >
              <ArrowUpDown className={`w-4 h-4 transition-transform ${sortDirection === 'desc' ? 'rotate-180' : ''}`} />
            </Button>
            <Button 
              variant={showOnlyWarnings ? 'destructive' : 'outline'}
              onClick={() => setShowOnlyWarnings(!showOnlyWarnings)}
              className={`gap-2 transition-all ${showOnlyWarnings ? 'animate-pulse' : ''}`}
              aria-label={showOnlyWarnings ? 'Showing only recipes with warnings' : 'Show all recipes'}
              aria-pressed={showOnlyWarnings}
            >
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Warnings</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="all" className="space-y-4 md:space-y-6">
        <TabsList className="grid w-full grid-cols-1 md:grid-cols-3 h-auto md:h-10">
          <TabsTrigger 
            value="all" 
            className="flex flex-col md:flex-row items-center gap-1 transition-all duration-200 data-[state=active]:shadow-sm"
            aria-label={`View all ${filteredRecipes.length} recipes`}
          >
            <span className="text-xs md:text-sm">All Recipes</span>
            <span className="text-xs">({filteredRecipes.length})</span>
          </TabsTrigger>
          <TabsTrigger 
            value="mapped" 
            className="flex flex-col md:flex-row items-center gap-1 transition-all duration-200 data-[state=active]:shadow-sm"
            aria-label={`View ${mappedRecipes.length} recipes mapped to POS`}
          >
            <span className="text-xs md:text-sm">Mapped to POS</span>
            <span className="text-xs">({mappedRecipes.length})</span>
          </TabsTrigger>
          <TabsTrigger 
            value="unmapped" 
            className="flex flex-col md:flex-row items-center gap-1 transition-all duration-200 data-[state=active]:shadow-sm"
            aria-label={`View ${unmappedRecipes.length} unmapped recipes`}
          >
            <span className="text-xs md:text-sm">Unmapped</span>
            <div className="flex items-center gap-1">
              <span className="text-xs">({unmappedRecipes.length})</span>
              {unmappedRecipes.length > 0 && (
                <Badge variant="secondary" className="text-xs h-4 px-1 ml-1" aria-label={`${unmappedRecipes.length} unmapped`}>
                  {unmappedRecipes.length}
                </Badge>
              )}
            </div>
          </TabsTrigger>
        </TabsList>

      <TabsContent value="all">
        <RecipeTable
          recipes={filteredRecipes}
          products={products}
          loading={loading}
          isError={isError}
          onRetry={fetchRecipes}
          onEdit={setEditingRecipe}
          onDelete={setDeletingRecipe}
          sortBy={sortBy}
          sortDirection={sortDirection}
          showOnlyWarnings={showOnlyWarnings}
          onCreate={handleOpenCreate}
          onCreateFromBase={handleCreateFromBase}
        />
      </TabsContent>

        <TabsContent value="mapped">
          <RecipeTable
            recipes={mappedRecipes}
            products={products}
            loading={loading}
            isError={isError}
            onRetry={fetchRecipes}
          onEdit={setEditingRecipe}
          onDelete={setDeletingRecipe}
          sortBy={sortBy}
          sortDirection={sortDirection}
          showOnlyWarnings={showOnlyWarnings}
          onCreate={handleOpenCreate}
          onCreateFromBase={handleCreateFromBase}
        />
      </TabsContent>

        <TabsContent value="unmapped">
          <RecipeTable
            recipes={unmappedRecipes}
            products={products}
            loading={loading}
            isError={isError}
            onRetry={fetchRecipes}
          onEdit={setEditingRecipe}
          onDelete={setDeletingRecipe}
          sortBy={sortBy}
          sortDirection={sortDirection}
          showOnlyWarnings={showOnlyWarnings}
          onCreate={handleOpenCreate}
          onCreateFromBase={handleCreateFromBase}
        />
      </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <RecipeCreateFromExistingDialog
        isOpen={isFromExistingOpen}
        onClose={() => {
          setIsFromExistingOpen(false);
          setCreateFromBaseRecipeId(null);
        }}
        recipes={recipes}
        products={products}
        fetchRecipeIngredients={fetchRecipeIngredients}
        initialRecipeId={createFromBaseRecipeId}
        onConfirm={({ prefill, basedOn }) => {
          setCreateFromBasePayload({ prefill, basedOn });
          setIsFromExistingOpen(false);
          setInitialPosItemName(undefined);
          setIsCreateDialogOpen(true);
          setCreateFromBaseRecipeId(null);
        }}
      />

      <RecipeDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setInitialPosItemName(undefined);
          setCreateFromBasePayload(null);
        }}
        restaurantId={selectedRestaurant?.restaurant_id}
        products={products}
        onRecipeUpdated={fetchRecipes}
        initialPosItemName={initialPosItemName}
        prefill={createFromBasePayload?.prefill}
        basedOn={createFromBasePayload?.basedOn}
        onEditProduct={setEditingProduct}
      />

      <RecipeDialog
        isOpen={!!editingRecipe}
        onClose={() => setEditingRecipe(null)}
        restaurantId={selectedRestaurant?.restaurant_id}
        products={products}
        recipe={editingRecipe}
        onRecipeUpdated={fetchRecipes}
        onCreateFromBase={(recipe) => {
          setEditingRecipe(null);
          setCreateFromBasePayload(null);
          setCreateFromBaseRecipeId(recipe.id);
          setIsFromExistingOpen(true);
        }}
        onEditProduct={setEditingProduct}
      />

      <DeleteRecipeDialog
        isOpen={!!deletingRecipe}
        onClose={() => setDeletingRecipe(null)}
        recipe={deletingRecipe}
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

interface RecipeTableProps {
  recipes: any[];
  products: any[];
  loading: boolean;
  isError?: boolean;
  onRetry?: () => void;
  onEdit: (recipe: any) => void;
  onDelete: (recipe: any) => void;
  sortBy: 'name' | 'cost' | 'salePrice' | 'margin' | 'created';
  sortDirection: 'asc' | 'desc';
  showOnlyWarnings: boolean;
  onCreate?: () => void;
  onCreateFromBase?: (recipe: any) => void;
}

function RecipeTable({ recipes, products, loading, isError, onRetry, onEdit, onDelete, sortBy, sortDirection, showOnlyWarnings, onCreate, onCreateFromBase }: RecipeTableProps) {
  const isMobile = useIsMobile();
  // Pre-calculate conversion validation for all recipes (keyed by recipe ID)
  const recipeValidationsById = useMemo(() => {
    const validationMap = new Map();
    recipes.forEach(recipe => {
      const ingredients = recipe.ingredients || [];
      validationMap.set(recipe.id, validateRecipeConversions(ingredients, products));
    });
    return validationMap;
  }, [recipes, products]);

  // Sort and filter recipes
  const processedRecipes = useMemo(() => {
    let result = [...recipes];

    // Filter by warnings if enabled
    if (showOnlyWarnings) {
      result = result.filter((recipe) => {
        const hasConversionIssues = recipeValidationsById.get(recipe.id)?.hasIssues;
        const hasNoIngredients = !recipe.ingredients || recipe.ingredients.length === 0;
        return hasConversionIssues || hasNoIngredients;
      });
    }

    // Sort recipes
    result.sort((a, b) => {
      let compareValue = 0;
      
      switch (sortBy) {
        case 'name':
          compareValue = a.name.localeCompare(b.name);
          break;
        case 'cost':
          compareValue = (a.estimated_cost || 0) - (b.estimated_cost || 0);
          break;
        case 'salePrice':
          compareValue = (a.avg_sale_price || 0) - (b.avg_sale_price || 0);
          break;
        case 'margin':
          compareValue = (a.profit_margin || 0) - (b.profit_margin || 0);
          break;
        case 'created':
          compareValue = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }

      return sortDirection === 'asc' ? compareValue : -compareValue;
    });

    return result;
  }, [recipes, recipeValidationsById, sortBy, sortDirection, showOnlyWarnings]);

  // Everything a row would otherwise derive during render, computed once per
  // list. Rows are memoized on this object's identity, so it must not be
  // rebuilt on scroll.
  const displayValuesById = useMemo(() => {
    const map = new Map<string, RecipeDisplayValues>();

    for (const recipe of processedRecipes) {
      const profit = recipe.profit_per_serving;
      const margin = recipe.profit_margin;

      map.set(recipe.id, {
        hasNoIngredients: !recipe.ingredients || recipe.ingredients.length === 0,
        validation: recipeValidationsById.get(recipe.id),
        formattedCost: `$${recipe.estimated_cost?.toFixed(2) || '0.00'}`,
        formattedSalePrice: recipe.avg_sale_price ? `$${recipe.avg_sale_price.toFixed(2)}` : null,
        formattedProfit: profit !== undefined ? `${profit > 0 ? '+' : ''}$${profit.toFixed(2)}` : null,
        profitIsPositive: (profit ?? 0) > 0,
        formattedMargin: margin !== undefined ? `${margin.toFixed(1)}%` : null,
        marginBadgeLabel: margin ? `${margin.toFixed(1)}%` : 'No profit data',
        marginIsPositive: (margin ?? 0) > 0,
        formattedDate: new Date(recipe.created_at).toLocaleDateString(),
      });
    }

    return map;
  }, [processedRecipes, recipeValidationsById]);

  // 133 recipes at the largest tenant crosses the 100+ virtualization
  // threshold; only the visible window plus overscan is ever mounted.
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: processedRecipes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isMobile ? 200 : 72),
    overscan: 10,
  });

  if (loading) {
    return (
      <Card className="border-border/50 shadow-sm">
        <CardContent className="p-12">
          <div className="flex flex-col items-center justify-center gap-4" role="status" aria-live="polite">
            <div className="space-y-4 w-full max-w-md">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
            <p className="text-sm text-muted-foreground sr-only">Loading recipes...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Distinct from "no recipes": a failed load must never look like an empty
  // menu, or a user reacts to an outage by re-creating recipes that exist.
  if (isError) {
    return (
      <Card className="border-destructive/20 bg-gradient-to-br from-destructive/5 via-destructive/10 to-transparent shadow-sm">
        <CardContent className="p-12">
          <div className="text-center space-y-4" role="alert" aria-live="assertive">
            <MetricIcon icon={AlertTriangle} variant="red" className="mx-auto" />
            <div>
              <h3 className="text-xl font-semibold mb-2">Couldn't load recipes</h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-4">
                Your recipes are still here — we just couldn't reach them. Check your
                connection and try again.
              </p>
              {onRetry && (
                <Button onClick={onRetry} variant="outline" className="gap-2" aria-label="Retry loading recipes">
                  Try again
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (processedRecipes.length === 0) {
    return (
      <Card className="border-border/50 bg-gradient-to-br from-background via-accent/5 to-background shadow-sm">
        <CardContent className="p-12">
          <div className="text-center space-y-4" role="status" aria-live="polite">
            {showOnlyWarnings ? (
              <>
                <MetricIcon icon={CheckCircle2} variant="emerald" className="mx-auto" />
                <div>
                  <h3 className="text-xl font-semibold mb-2">No recipes with warnings</h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    All recipes have ingredients and valid conversions. Your recipe setup is looking great!
                  </p>
                </div>
              </>
            ) : (
              <>
                <MetricIcon icon={ChefHat} variant="purple" className="mx-auto" />
                <div>
                  <h3 className="text-xl font-semibold mb-2">No recipes found</h3>
                  <p className="text-muted-foreground max-w-md mx-auto mb-4">
                    Create your first recipe to start tracking ingredient costs and profitability.
                  </p>
                  {onCreate && (
                    <Button onClick={onCreate} className="gap-2" aria-label="Create your first recipe">
                      <Plus className="w-4 h-4" aria-hidden="true" />
                      Create Your First Recipe
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 overflow-hidden">
      <CardContent className="p-0">
        {/* Mobile-friendly cards for small screens. Rendered conditionally, not
            hidden with `md:hidden`: both variants used to mount, so every recipe
            row was built twice and only one was ever visible. */}
        {isMobile && (
        <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
          <div
            role="presentation"
            style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const recipe = processedRecipes[virtualRow.index];
              const displayValues = recipe && displayValuesById.get(recipe.id);
              if (!displayValues) return null;

              return (
                <MemoizedRecipeCard
                  key={recipe.id}
                  recipe={recipe}
                  displayValues={displayValues}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onCreateFromBase={onCreateFromBase}
                  index={virtualRow.index}
                  measureRef={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                />
              );
            })}
          </div>
        </div>
        )}

        {/* Desktop table for larger screens. An ARIA table of flex rows rather
            than a real <table>: virtualized rows are absolutely positioned,
            which table layout cannot express. */}
        {!isMobile && (
        <div className="overflow-x-auto">
          <div role="table" aria-label="Recipes" className={RECIPE_TABLE_MIN_WIDTH}>
            <div role="rowgroup">
              <div role="row" className="flex items-center gap-2 px-4 py-3 border-b bg-muted/50 font-medium text-sm text-muted-foreground">
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.name}>Recipe Name</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.posItem}>POS Item</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.conversions}>Conversions</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.servingSize}>Serving Size</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.cost}>Cost</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.salePrice}>Avg Sale Price</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.profit}>Profit</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.margin}>Margin %</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.created}>Created</div>
                <div role="columnheader" className={RECIPE_COLUMN_WIDTHS.actions}>Actions</div>
              </div>
            </div>
            {/* The scroll container is the rowgroup; the sizer inside it is
                presentational so the rows stay owned by the rowgroup. */}
            <div role="rowgroup" ref={parentRef} className="max-h-[70vh] overflow-y-auto">
              <div
                role="presentation"
                style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const recipe = processedRecipes[virtualRow.index];
                  const displayValues = recipe && displayValuesById.get(recipe.id);
                  if (!displayValues) return null;

                  return (
                    <MemoizedRecipeRow
                      key={recipe.id}
                      recipe={recipe}
                      displayValues={displayValues}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onCreateFromBase={onCreateFromBase}
                      index={virtualRow.index}
                      measureRef={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

