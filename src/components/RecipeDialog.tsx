import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { useRecipes, Recipe, CreateRecipeData } from '@/hooks/useRecipes';
import { useProducts } from '@/hooks/useProducts';
import { Plus, Trash2, DollarSign } from 'lucide-react';
import { RecipeConversionInfo } from '@/components/RecipeConversionInfo';

const measurementUnits = [
  'oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 
  'bottle', 'can', 'bag', 'box', 'piece', 'serving'
];

const formSchema = z.object({
  name: z.string().min(1, 'Recipe name is required'),
  description: z.string().optional(),
  pos_item_name: z.string().optional(),
  pos_item_id: z.string().optional(),
  serving_size: z.number().min(0.1, 'Serving size must be greater than 0'),
  ingredients: z.array(z.object({
    product_id: z.string().min(1, 'Product is required'),
    quantity: z.number().min(0.001, 'Quantity must be greater than 0'),
    unit: z.enum(['oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 'bottle', 'can', 'bag', 'box', 'piece', 'serving']),
    notes: z.string().optional(),
  })).min(1, 'At least one ingredient is required'),
});

type FormData = z.infer<typeof formSchema>;

interface RecipeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantId: string;
  recipe?: Recipe | null;
}

export function RecipeDialog({ isOpen, onClose, restaurantId, recipe }: RecipeDialogProps) {
  const { createRecipe, updateRecipe, fetchRecipeIngredients } = useRecipes(restaurantId);
  const { products } = useProducts(restaurantId);
  const [loading, setLoading] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState(0);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      pos_item_name: '',
      pos_item_id: '',
      serving_size: 1,
      ingredients: [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'ingredients',
  });

  // Load recipe data for editing
  useEffect(() => {
    if (recipe && isOpen) {
      const loadRecipeData = async () => {
        try {
          const ingredients = await fetchRecipeIngredients(recipe.id);
          
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
                  unit: (measurementUnits.includes(ing.unit as any) ? ing.unit : 'oz') as 'oz' | 'ml' | 'cup' | 'tbsp' | 'tsp' | 'lb' | 'kg' | 'g' | 'bottle' | 'can' | 'bag' | 'box' | 'piece' | 'serving',
                  notes: ing.notes || '',
                }))
              : [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
          });
        } catch (error) {
          console.error('Error loading recipe data:', error);
        }
      };

      loadRecipeData();
    } else if (!recipe) {
      form.reset({
        name: '',
        description: '',
        pos_item_name: '',
        pos_item_id: '',
        serving_size: 1,
        ingredients: [{ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' }],
      });
    }
  }, [recipe, isOpen, form, fetchRecipeIngredients]);

  // Calculate estimated cost when ingredients change using proper unit conversions
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.ingredients) {
        const cost = value.ingredients.reduce((total, ingredient) => {
          if (ingredient?.product_id && ingredient?.quantity) {
            const product = products.find(p => p.id === ingredient.product_id);
            if (product?.cost_per_unit && product?.conversion_factor) {
              // Calculate cost per recipe unit = cost per purchase unit / conversion factor
              const costPerRecipeUnit = product.cost_per_unit / (product.conversion_factor || 1);
              return total + (ingredient.quantity * costPerRecipeUnit);
            }
          }
          return total;
        }, 0);
        setEstimatedCost(cost);
      }
    });
    return () => subscription.unsubscribe();
  }, [products]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      if (recipe) {
        // Update existing recipe
        await updateRecipe(recipe.id, {
          name: data.name,
          description: data.description,
          pos_item_name: data.pos_item_name,
          pos_item_id: data.pos_item_id,
          serving_size: data.serving_size,
        });
        
        // TODO: Update ingredients (would need additional API endpoints)
      } else {
        // Create new recipe
        await createRecipe(data as CreateRecipeData);
      }
      
      onClose();
    } catch (error) {
      console.error('Error saving recipe:', error);
    } finally {
      setLoading(false);
    }
  };

  const addIngredient = () => {
    append({ product_id: '', quantity: 1, unit: 'oz' as const, notes: '' });
  };

  const removeIngredient = (index: number) => {
    if (fields.length > 1) {
      remove(index);
    }
  };

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
                        <FormLabel>Recipe Name *</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., Margarita" {...field} />
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
                          <Input placeholder="e.g., Margarita - Large" {...field} />
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
                          <Input placeholder="Internal POS system ID" {...field} />
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
                {fields.map((field, index) => (
                  <div key={field.id} className="space-y-4 p-4 border rounded-lg">
                    <div className="flex items-end gap-4">
                      <FormField
                        control={form.control}
                        name={`ingredients.${index}.product_id`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel>Product</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select product" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    <div className="flex flex-col">
                                      <span>{product.name}</span>
                                      {product.cost_per_unit && product.conversion_factor && (
                                        <span className="text-xs text-muted-foreground">
                                          ${(product.cost_per_unit / (product.conversion_factor || 1)).toFixed(3)}/{product.uom_recipe || 'unit'}
                                          {product.uom_purchase && (
                                            <span className="ml-1">
                                              (${product.cost_per_unit.toFixed(2)}/{product.uom_purchase})
                                            </span>
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`ingredients.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem className="w-24">
                            <FormLabel>Qty</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.001"
                                {...field}
                                onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`ingredients.${index}.unit`}
                        render={({ field }) => (
                          <FormItem className="w-24">
                            <FormLabel>Unit</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select unit" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {measurementUnits.map((unit) => (
                                  <SelectItem key={unit} value={unit}>
                                    {unit}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name={`ingredients.${index}.notes`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel>Notes</FormLabel>
                            <FormControl>
                              <Input placeholder="Optional notes..." {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeIngredient(index)}
                        disabled={fields.length === 1}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    {/* Show conversion info if product is selected */}
                    {(() => {
                      const currentIngredient = form.watch(`ingredients.${index}`);
                      const selectedProduct = products.find(p => p.id === currentIngredient?.product_id);
                      
                      if (selectedProduct && currentIngredient?.quantity && selectedProduct.conversion_factor) {
                        return (
                          <RecipeConversionInfo
                            product={selectedProduct}
                            recipeQuantity={currentIngredient.quantity}
                            recipeUnit={currentIngredient.unit}
                          />
                        );
                      }
                      return null;
                    })()}
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Saving...' : recipe ? 'Update Recipe' : 'Create Recipe'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}