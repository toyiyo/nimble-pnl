import { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, DollarSign, Calculator, ChefHat } from 'lucide-react';
import { useRecipes, Recipe, CreateRecipeData } from '@/hooks/useRecipes';
import { useProducts } from '@/hooks/useProducts';
import { usePOSItems } from '@/hooks/usePOSItems';
import { RecipeIngredientItem } from '@/components/RecipeIngredientItem';
import { SearchablePOSItemSelector } from '@/components/SearchablePOSItemSelector';
import { RecipeConversionInfo } from '@/components/RecipeConversionInfo';
import { calculateInventoryImpact, getProductUnitInfo } from "@/lib/enhancedUnitConversion";
import { MEASUREMENT_UNITS, IngredientUnit, toIngredientUnit } from '@/lib/recipeUnits';

const formSchema = z.object({
  name: z.string().min(1, 'Recipe name is required'),
  description: z.string().optional(),
  pos_item_name: z.string().optional(),
  pos_item_id: z.string().optional(),
  serving_size: z.number().min(0.1, 'Serving size must be greater than 0'),
  ingredients: z.array(z.object({
    product_id: z.string().min(1, 'Product is required'),
    quantity: z.number().min(0.001, 'Quantity must be greater than 0'),
    unit: z.enum(MEASUREMENT_UNITS),
    notes: z.string().optional(),
  })).min(1, 'At least one ingredient is required'),
});

type FormData = z.infer<typeof formSchema>;

interface RecipeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
  recipe?: Recipe | null;
  onRecipeUpdated?: () => void;
  initialPosItemName?: string;
  prefill?: Partial<FormData>;
  basedOn?: { id: string; name: string };
  onCreateFromBase?: (recipe: Recipe) => void;
}

export function RecipeDialog({ isOpen, onClose, restaurantId, recipe, onRecipeUpdated, initialPosItemName, prefill, basedOn, onCreateFromBase }: RecipeDialogProps) {
  const { createRecipe, updateRecipe, updateRecipeIngredients, fetchRecipeIngredients, calculateRecipeCost } = useRecipes(restaurantId);
  const { products } = useProducts(restaurantId);
  const { posItems, loading: posItemsLoading } = usePOSItems(restaurantId);
  const navigate = useNavigate();
  
  const [loading, setLoading] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState(0);
  const [expandedIngredients, setExpandedIngredients] = useState<Record<number, boolean>>({});

  const defaultValues: FormData = {
    name: '',
    description: '',
    pos_item_name: '',
    pos_item_id: '',
    serving_size: 1,
    ingredients: [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'ingredients',
  });

  // Load recipe data for editing
  useEffect(() => {
    if (recipe && isOpen) {
      if (import.meta.env.DEV) {
        console.log('Loading recipe data for recipe:', recipe.id);
      }
      const loadRecipeData = async () => {
        try {
          const ingredients = await fetchRecipeIngredients(recipe.id);
          if (import.meta.env.DEV) {
            console.log('Loaded ingredients:', ingredients);
          }
          
          form.reset({
            name: recipe.name,
            description: recipe.description || '',
            pos_item_name: recipe.pos_item_name || '',
            pos_item_id: recipe.pos_item_id || '',
            serving_size: recipe.serving_size,
            ingredients: ingredients.length > 0 
              ? ingredients.map(ing => ({
                  product_id: ing.product_id,
                  quantity: ing.quantity,
                  unit: toIngredientUnit(ing.unit),
                  notes: ing.notes || '',
                }))
              : [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
          });
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Error loading recipe data:', error);
          }
        }
      };

      loadRecipeData();
    } else if (!recipe && isOpen) {
      if (import.meta.env.DEV) {
        console.log('Resetting form for new recipe with initialPosItemName:', initialPosItemName);
      }
      
      // Check if we're returning from creating a product
      const recipeStateJson = sessionStorage.getItem('recipeFormState');
      if (recipeStateJson) {
        try {
          const recipeState = JSON.parse(recipeStateJson);
          sessionStorage.removeItem('recipeFormState');
          
          // Restore the form state
          form.reset({
            name: recipeState.name || '',
            description: recipeState.description || '',
            pos_item_name: recipeState.pos_item_name || '',
            pos_item_id: recipeState.pos_item_id || '',
            serving_size: recipeState.serving_size || 1,
            ingredients: recipeState.ingredients || [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
          });
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Error restoring recipe state:', error);
          }
          // Fall back to default behavior
          form.reset({
            name: initialPosItemName || '',
            description: '',
            pos_item_name: initialPosItemName || '',
            pos_item_id: '',
            serving_size: 1,
            ingredients: [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
          });
        }
      } else {
        const posDefaults = initialPosItemName
          ? { name: initialPosItemName, pos_item_name: initialPosItemName }
          : {};
        const mergedDefaults: FormData = {
          ...defaultValues,
          ...posDefaults,
          ...prefill,
          ingredients: prefill?.ingredients?.length ? prefill.ingredients : defaultValues.ingredients,
        };

        form.reset(mergedDefaults);
      }
    }
  }, [recipe?.id, isOpen, initialPosItemName, form, prefill]); // Only depend on recipe.id, not the whole recipe object or fetchRecipeIngredients

  const nameValue = form.watch('name') || '';
  const baseName = basedOn?.name?.trim().toLowerCase();
  const isNameValid = nameValue.trim().length > 0 && nameValue.trim().toLowerCase() !== baseName;
  const isSubmitDisabled = loading || (basedOn ? !isNameValid : false);

  // Calculate estimated cost when ingredients change using enhanced unit conversions
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.ingredients) {
        let totalCost = 0;
        let hasValidIngredients = false;

        try {
          value.ingredients.forEach((ingredient: any) => {
            if (ingredient?.product_id && ingredient?.quantity && ingredient?.unit) {
              const product = products.find(p => p.id === ingredient.product_id);
              if (product?.cost_per_unit) {
                hasValidIngredients = true;
                
                try {
                  // Use shared helper to get validated product unit info
                  const { purchaseUnit, quantityPerPurchaseUnit, sizeValue, sizeUnit } = getProductUnitInfo(product);
                  const costPerUnit = product.cost_per_unit || 0;
                  
                  const result = calculateInventoryImpact(
                    ingredient.quantity,
                    ingredient.unit,
                    quantityPerPurchaseUnit,
                    purchaseUnit,
                    product.name || '',
                    costPerUnit,
                    sizeValue,
                    sizeUnit
                  );
                  
                  totalCost += result.costImpact;
                } catch (conversionError) {
                  console.warn(`Conversion error for ${product.name}:`, conversionError);
                  // Skip this ingredient in cost calculation rather than breaking everything
                }
              }
            }
          });

          if (hasValidIngredients) {
            setEstimatedCost(totalCost);
          } else {
            setEstimatedCost(0);
          }
        } catch (error) {
          console.warn('Cost calculation error:', error);
          setEstimatedCost(0);
        }
      }
    });
    return () => subscription.unsubscribe();
  }, [products]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      if (recipe) {
        // Update existing recipe
        const updateSuccess = await updateRecipe(recipe.id, {
          name: data.name,
          description: data.description,
          pos_item_name: data.pos_item_name,
          pos_item_id: data.pos_item_id,
          serving_size: data.serving_size,
        });
        
        if (updateSuccess) {
          // Update ingredients - filter out empty ingredients
          const validIngredients = data.ingredients.filter(ing => 
            ing.product_id && ing.quantity && ing.quantity > 0
          ) as {
            product_id: string;
            quantity: number;
            unit: IngredientUnit;
            notes?: string;
          }[];
          await updateRecipeIngredients(recipe.id, validIngredients);
          
          // Recalculate and update recipe cost
          const cost = await calculateRecipeCost(recipe.id);
          if (cost !== null) {
            await updateRecipe(recipe.id, { estimated_cost: cost });
          }
        }
      } else {
        // Create new recipe - add restaurant_id to form data
        const createData: CreateRecipeData = {
          name: data.name,
          description: data.description,
          pos_item_name: data.pos_item_name,
          pos_item_id: data.pos_item_id,
          serving_size: data.serving_size,
          restaurant_id: restaurantId,
          ingredients: data.ingredients.filter(ing => 
            ing.product_id && ing.quantity && ing.quantity > 0
          ) as {
            product_id: string;
            quantity: number;
            unit: IngredientUnit;
            notes?: string;
          }[],
        };
        await createRecipe(createData);
      }
      
      onClose();
      onRecipeUpdated?.(); // Refresh parent list
    } catch (error) {
      console.error('Error saving recipe:', error);
    } finally {
      setLoading(false);
    }
  };

  const addIngredient = useCallback(() => {
    append({ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' });
  }, [append]);

  const removeIngredient = useCallback((index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
    // Also remove from expanded state
    setExpandedIngredients(prev => {
      const newState = { ...prev };
      delete newState[index];
      // Shift down remaining indices
      Object.keys(newState).forEach(key => {
        const keyNum = parseInt(key);
        if (keyNum > index) {
          newState[keyNum - 1] = newState[keyNum];
          delete newState[keyNum];
        }
      });
      return newState;
    });
  }, [fields.length, remove]);
  
  const toggleConversionDetails = (index: number) => {
    setExpandedIngredients(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };
  
  const handleCreateNewProduct = useCallback(() => {
    // Store the current recipe state in sessionStorage so we can restore it
    const currentFormData = form.getValues();
    sessionStorage.setItem('recipeFormState', JSON.stringify({
      ...currentFormData,
      restaurantId,
      isEditing: !!recipe,
      recipeId: recipe?.id
    }));
    
    // Navigate to inventory page
    navigate('/inventory?create=true');
  }, [form, restaurantId, recipe, navigate]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {recipe ? 'Edit Recipe' : 'Create New Recipe'}
          </DialogTitle>
          <DialogDescription>
            {recipe 
              ? 'Update the recipe details and ingredients.' 
              : 'Create a new recipe with ingredients and portions.'}
          </DialogDescription>
          {recipe && onCreateFromBase && (
            <div className="mt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onCreateFromBase(recipe)}
              >
                Create variation
              </Button>
            </div>
          )}
          {basedOn && (
            <div className="mt-3 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
              <span className="font-medium">Based on {basedOn.name}</span>
            </div>
          )}
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Basic Information */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel htmlFor="recipe-name">Recipe Name *</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="e.g., Margarita" 
                            id="recipe-name"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Brief description of the recipe..."
                            rows={3}
                            id="recipe-description"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="serving_size"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Serving Size *</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            step="0.1"
                            placeholder="1"
                            id="recipe-serving-size"
                            {...field}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 1)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* POS Mapping */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">POS Integration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="pos_item_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>POS Item Name</FormLabel>
                        <FormControl>
                          <SearchablePOSItemSelector
                            value={field.value}
                            onValueChange={(itemName, itemId) => {
                              field.onChange(itemName);
                              if (itemId) {
                                form.setValue('pos_item_id', itemId);
                              }
                            }}
                            posItems={posItems}
                            loading={posItemsLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="pos_item_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>POS Item ID</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Internal POS system ID" 
                            id="pos-item-id"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="p-4 bg-muted rounded-lg">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Estimated Cost:</span>
                      <Badge variant="secondary" className="text-lg">
                        <DollarSign className="w-4 h-4 mr-1" />
                        {estimatedCost.toFixed(2)}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Ingredients */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Ingredients</CardTitle>
                  <Button type="button" variant="outline" onClick={addIngredient}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Ingredient
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {fields.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                      <ChefHat className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground mb-4">
                        No ingredients added yet. Click "Add Ingredient" to start building your recipe.
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {fields.map((field, index) => (
                      <RecipeIngredientItem
                        key={field.id}
                        index={index}
                        control={form.control}
                        products={products}
                        onRemove={() => removeIngredient(index)}
                        showConversionDetails={!!expandedIngredients[index]}
                        toggleConversionDetails={() => toggleConversionDetails(index)}
                        measurementUnits={MEASUREMENT_UNITS}
                        onCreateNewProduct={handleCreateNewProduct}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitDisabled}>
                {loading ? 'Saving...' : recipe ? 'Update Recipe' : 'Create Recipe'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
