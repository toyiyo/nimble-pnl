import { useState, useEffect, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useRecipes } from '@/hooks/useRecipes';
import { useProducts } from '@/hooks/useProducts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
import { RecipeConversionStatusBadge } from '@/components/RecipeConversionStatusBadge';
import { validateRecipeConversions } from '@/utils/recipeConversionValidation';
import { ChefHat, Plus, Search, Edit, Trash2, DollarSign, Clock, Settings, ArrowUpDown, AlertTriangle, Sparkles, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MetricIcon } from '@/components/MetricIcon';
import { PageHeader } from '@/components/PageHeader';

export default function Recipes() {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selectedRestaurant, setSelectedRestaurant, restaurants, loading: restaurantsLoading, createRestaurant } = useRestaurantContext();
  const { recipes, loading, fetchRecipes } = useRecipes(selectedRestaurant?.restaurant_id || null);
  const { products } = useProducts(selectedRestaurant?.restaurant_id || null);
  const { unmappedItems } = useUnifiedSales(selectedRestaurant?.restaurant_id || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<any>(null);
  const [deletingRecipe, setDeletingRecipe] = useState<any>(null);
  const [showAutoSettings, setShowAutoSettings] = useState(false);
  const [initialPosItemName, setInitialPosItemName] = useState<string | undefined>();
  const [newProductId, setNewProductId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'cost' | 'salePrice' | 'margin' | 'created'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showOnlyWarnings, setShowOnlyWarnings] = useState(false);

  const { setupAutoDeduction } = useAutomaticInventoryDeduction();

  // Check if we navigated here with a POS item to create a recipe for
  useEffect(() => {
    if (location.state?.createRecipeFor) {
      setInitialPosItemName(location.state.createRecipeFor);
      setIsCreateDialogOpen(true);
      // Clear the state after using it
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);
  
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

  // Compute filtered recipes and memoized lists before early returns
  const filteredRecipes = recipes.filter(recipe =>
    recipe.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    recipe.pos_item_name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const unmappedRecipes = useMemo(() => {
    return filteredRecipes.filter(recipe => !recipe.pos_item_name);
  }, [filteredRecipes]);

  const mappedRecipes = useMemo(() => {
    return filteredRecipes.filter(recipe => recipe.pos_item_name);
  }, [filteredRecipes]);

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
            <Button 
              onClick={() => setIsCreateDialogOpen(true)} 
              className="w-full sm:w-auto gap-2 group bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary transition-all duration-200"
              aria-label="Create new recipe"
            >
              <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" aria-hidden="true" />
              <span className="hidden sm:inline">Create Recipe</span>
              <span className="sm:hidden">New Recipe</span>
            </Button>
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
            onEdit={setEditingRecipe}
            onDelete={setDeletingRecipe}
            sortBy={sortBy}
            sortDirection={sortDirection}
            showOnlyWarnings={showOnlyWarnings}
            onCreate={() => setIsCreateDialogOpen(true)}
          />
        </TabsContent>

        <TabsContent value="mapped">
          <RecipeTable
            recipes={mappedRecipes}
            products={products}
            loading={loading}
            onEdit={setEditingRecipe}
            onDelete={setDeletingRecipe}
            sortBy={sortBy}
            sortDirection={sortDirection}
            showOnlyWarnings={showOnlyWarnings}
            onCreate={() => setIsCreateDialogOpen(true)}
          />
        </TabsContent>

        <TabsContent value="unmapped">
          <RecipeTable
            recipes={unmappedRecipes}
            products={products}
            loading={loading}
            onEdit={setEditingRecipe}
            onDelete={setDeletingRecipe}
            sortBy={sortBy}
            sortDirection={sortDirection}
            showOnlyWarnings={showOnlyWarnings}
            onCreate={() => setIsCreateDialogOpen(true)}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <RecipeDialog
        isOpen={isCreateDialogOpen}
        onClose={() => {
          setIsCreateDialogOpen(false);
          setInitialPosItemName(undefined);
        }}
        restaurantId={selectedRestaurant?.restaurant_id}
        onRecipeUpdated={fetchRecipes}
        initialPosItemName={initialPosItemName}
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
  products: any[];
  loading: boolean;
  onEdit: (recipe: any) => void;
  onDelete: (recipe: any) => void;
  sortBy: 'name' | 'cost' | 'salePrice' | 'margin' | 'created';
  sortDirection: 'asc' | 'desc';
  showOnlyWarnings: boolean;
  onCreate?: () => void;
}

function RecipeTable({ recipes, products, loading, onEdit, onDelete, sortBy, sortDirection, showOnlyWarnings, onCreate }: RecipeTableProps) {
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
      result = result.filter((recipe) => recipeValidationsById.get(recipe.id)?.hasIssues);
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
                    All recipes have valid conversions. Your recipe setup is looking great!
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
        {/* Mobile-friendly cards for small screens */}
        <div className="block md:hidden">
        {processedRecipes.map((recipe) => {
            const validation = recipeValidationsById.get(recipe.id);
            
            return (
              <div key={recipe.id} className="p-4 border-b last:border-b-0 hover:bg-accent/50 transition-colors">
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
                    <RecipeConversionStatusBadge 
                      hasIssues={validation.hasIssues} 
                      issueCount={validation.issueCount}
                      size="sm"
                      showText={false}
                    />
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
            );
          })}
        </div>

        {/* Desktop table for larger screens */}
        <div className="hidden md:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipe Name</TableHead>
                <TableHead>POS Item</TableHead>
                <TableHead>Conversions</TableHead>
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
              {processedRecipes.map((recipe) => {
                const validation = recipeValidationsById.get(recipe.id);
                
                return (
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
                    <TableCell>
                      <RecipeConversionStatusBadge 
                        hasIssues={validation.hasIssues} 
                        issueCount={validation.issueCount}
                        size="sm"
                        showText={true}
                      />
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
               );
             })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}