import { useEffect, useMemo, useState } from 'react';
import { PrepRecipe } from '@/hooks/usePrepRecipes';
import { Product } from '@/hooks/useProducts';
import { IngredientUnit, MEASUREMENT_UNITS } from '@/lib/recipeUnits';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Separator } from '@/components/ui/separator';
import { calculateIngredientsCost, formatCostResult } from '@/lib/prepCostCalculation';

export interface PrepRecipeFormValues {
  name: string;
  description?: string;
  output_product_id?: string | null;
  default_yield: number;
  default_yield_unit: IngredientUnit;
  prep_time_minutes?: number | null;
  ingredients: Array<{
    id?: string;
    product_id: string;
    quantity: number;
    unit: IngredientUnit;
    notes?: string;
    sort_order?: number;
  }>;
}

interface PrepRecipeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (values: PrepRecipeFormValues) => Promise<void>;
  readonly products: Product[];
  readonly editingRecipe?: PrepRecipe | null;
}

const defaultForm: PrepRecipeFormValues = {
  name: '',
  description: '',
  output_product_id: undefined,
  default_yield: 1,
  default_yield_unit: 'unit',
  prep_time_minutes: null,
  ingredients: [
    { product_id: '', quantity: 1, unit: 'kg' as IngredientUnit, sort_order: 0 },
  ],
};

export function PrepRecipeDialog({
  open,
  onOpenChange,
  onSubmit,
  products,
  editingRecipe,
}: PrepRecipeDialogProps) {
  const [formValues, setFormValues] = useState<PrepRecipeFormValues>(defaultForm);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (editingRecipe) {
      setFormValues({
        name: editingRecipe.name,
        description: editingRecipe.description || '',
        output_product_id: editingRecipe.output_product_id || undefined,
        default_yield: editingRecipe.default_yield || 1,
        default_yield_unit: editingRecipe.default_yield_unit || 'unit',
        prep_time_minutes: editingRecipe.prep_time_minutes ?? null,
        ingredients: (editingRecipe.ingredients || []).map((ing, index) => ({
          id: ing.id,
          product_id: ing.product_id,
          quantity: ing.quantity,
          unit: ing.unit,
          notes: ing.notes,
          sort_order: ing.sort_order ?? index,
        })),
      });
    } else {
      setFormValues(defaultForm);
    }
  }, [editingRecipe, open]);

  const ingredientRows = formValues.ingredients;

  const productLookup = useMemo(() => {
    const map = new Map<string, Product>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  // Compute a live preview of cost and inventory deduction for the current ingredient rows.
  // Uses the shared calculation logic in src/lib/prepCostCalculation.ts
  const previewCost = useMemo(() => {
    const ingredientInfos = formValues.ingredients.map((ing) => {
      const product = productLookup.get(ing.product_id);
      return {
        product_id: ing.product_id,
        quantity: ing.quantity,
        unit: ing.unit,
        product: product
          ? {
              id: product.id,
              name: product.name,
              cost_per_unit: product.cost_per_unit ?? 0,
              uom_purchase: product.uom_purchase,
              size_value: product.size_value,
              size_unit: product.size_unit,
              current_stock: product.current_stock,
            }
          : undefined,
      };
    });

    return calculateIngredientsCost(ingredientInfos);
  }, [formValues.ingredients, productLookup]);

  const handleIngredientChange = <K extends keyof PrepRecipeFormValues['ingredients'][number]>(
    index: number,
    field: K,
    value: PrepRecipeFormValues['ingredients'][number][K],
  ) => {
    const updated = [...formValues.ingredients];
    updated[index] = { ...updated[index], [field]: value };
    setFormValues({ ...formValues, ingredients: updated });
  };

  const addIngredientRow = () => {
    setFormValues({
      ...formValues,
      ingredients: [
        ...formValues.ingredients,
        {
          product_id: '',
          quantity: 1,
          unit: formValues.default_yield_unit || 'unit',
          sort_order: formValues.ingredients.length,
        },
      ],
    });
  };

  const removeIngredientRow = (index: number) => {
    const updated = formValues.ingredients.filter((_, i) => i !== index);
    setFormValues({ ...formValues, ingredients: updated });
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onSubmit({
        ...formValues,
        output_product_id: formValues.output_product_id || undefined,
        ingredients: formValues.ingredients.filter((ing) => ing.product_id),
      });
      onOpenChange(false);
    } catch (err: unknown) {
      console.error('Error saving prep recipe:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      toast({
        title: 'Failed to save recipe',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-5xl h-[90dvh] max-h-[90dvh] overflow-hidden p-0 flex flex-col">
        <div className="flex h-full flex-col">
          <div className="sticky top-0 z-10 border-b bg-background/95 px-6 py-4 backdrop-blur">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-lg md:text-xl">{editingRecipe ? 'Edit Prep Recipe' : 'New Prep Recipe'}</DialogTitle>
              <DialogDescription>
                Define the blueprint for a prep item. Ingredients here do not move inventory until a batch is completed.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.05fr_1.2fr]">
              <div className="space-y-3 rounded-lg border bg-card/40 p-4">
                <div className="space-y-1">
                  <Label htmlFor="name">Recipe name</Label>
                  <Input
                    id="name"
                    value={formValues.name}
                    onChange={(e) => setFormValues({ ...formValues, name: e.target.value })}
                    placeholder="Chicken Soup Base"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formValues.description}
                    onChange={(e) => setFormValues({ ...formValues, description: e.target.value })}
                    placeholder="What is this prep item and when is it used?"
                    className="min-h-[96px]"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="output">Output item</Label>
                  <Select
                    value={formValues.output_product_id || ''}
                    onValueChange={(value) => setFormValues({ ...formValues, output_product_id: value || undefined })}
                  >
                    <SelectTrigger id="output">
                      <SelectValue placeholder="Select inventory item (prep output)" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name}
                          <Badge variant="outline" className="ml-2">
                            {product.uom_purchase || 'unit'}
                          </Badge>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Needed so completed batches can add inventory.</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="default_yield">Default yield</Label>
                    <Input
                      id="default_yield"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formValues.default_yield}
                      onChange={(e) =>
                        setFormValues({ ...formValues, default_yield: Number.parseFloat(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="default_yield_unit">Yield unit</Label>
                    <Select
                      value={formValues.default_yield_unit}
                      onValueChange={(value) =>
                        setFormValues({ ...formValues, default_yield_unit: value as IngredientUnit })
                      }
                    >
                      <SelectTrigger id="default_yield_unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MEASUREMENT_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="prep_time">Prep time (min)</Label>
                    <Input
                      id="prep_time"
                      type="number"
                      min="0"
                      value={formValues.prep_time_minutes ?? ''}
                      onChange={(e) =>
                        setFormValues({
                          ...formValues,
                          prep_time_minutes: e.target.value ? Number.parseInt(e.target.value, 10) : null,
                        })
                      }
                      placeholder="45"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-3 rounded-lg border bg-card/40 p-4 min-h-0 max-h-[50vh] lg:max-h-none">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
                  <div>
                    <Label>Ingredients</Label>
                    <p className="text-xs text-muted-foreground">Expected amounts for one default batch</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={addIngredientRow} className="w-full sm:w-auto">
                    <Plus className="h-4 w-4 mr-2" />
                    Add ingredient
                  </Button>
                </div>

                <ScrollArea className="flex-1 min-h-0 pr-2">
                  <div className="space-y-3 pb-1">
                    {ingredientRows.map((ingredient, index) => (
                      <div key={ingredient.id || `temp-${index}`} className="rounded-lg border bg-card p-3 shadow-sm space-y-3">
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-12 sm:col-span-5 space-y-1">
                            <Label>Product</Label>
                            <Select
                              value={ingredient.product_id}
                              onValueChange={(value) => handleIngredientChange(index, 'product_id', value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select product" />
                              </SelectTrigger>
                              <SelectContent>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="col-span-6 sm:col-span-3 space-y-1">
                            <Label htmlFor={`ingredient-quantity-${ingredient.id || index}`}>Quantity</Label>
                            <Input
                              id={`ingredient-quantity-${ingredient.id || index}`}
                              type="number"
                              min="0"
                              step="0.01"
                              value={ingredient.quantity}
                              onChange={(e) => handleIngredientChange(index, 'quantity', Number.parseFloat(e.target.value) || 0)}
                            />
                          </div>

                          <div className="col-span-6 sm:col-span-3 space-y-1">
                            <Label>Unit</Label>
                            <Select
                              value={ingredient.unit}
                              onValueChange={(value) => handleIngredientChange(index, 'unit', value as IngredientUnit)}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {MEASUREMENT_UNITS.map((unit) => (
                                  <SelectItem key={unit} value={unit}>
                                    {unit}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="col-span-12 sm:col-span-1 flex justify-end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => removeIngredientRow(index)}
                              aria-label="Remove ingredient"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label>Notes</Label>
                          <Input
                            value={ingredient.notes || ''}
                            onChange={(e) => handleIngredientChange(index, 'notes', e.target.value)}
                            placeholder="Prep notes, trim %, alternates"
                          />
                        </div>

                        {/* Cost & inventory preview for this ingredient */}
                        <div className="flex items-center justify-between text-sm text-muted-foreground mt-2" aria-live="polite">
                          {ingredient.product_id ? (
                            previewCost.ingredients[index] ? (
                              <>
                                <div>
                                  <span className="text-muted-foreground">Cost</span>
                                  <div className="font-medium">${previewCost.ingredients[index].costImpact.toFixed(2)}</div>
                                </div>

                                <div className="text-right">
                                  <span className="text-muted-foreground">Inventory</span>
                                  <div className="font-medium">
                                    {previewCost.ingredients[index].inventoryDeduction.toFixed(4)} {previewCost.ingredients[index].inventoryDeductionUnit}
                                  </div>
                                </div>
                              </>
                            ) : (
                              <div className="text-muted-foreground">Calculating…</div>
                            )
                          ) : (
                            <div className="text-muted-foreground">No product selected</div>
                          )}
                        </div>
                      </div>
                    ))}

                    {ingredientRows.length === 0 && (
                      <div className="text-sm text-muted-foreground border border-dashed rounded-lg p-4">
                        Add at least one ingredient to define this prep recipe.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
            <div className="mt-4 rounded-lg border bg-card/60 p-4 lg:hidden">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Summary</Label>
                  <p className="text-xs text-muted-foreground">Quick check before saving</p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {ingredientRows.length} ingredient{ingredientRows.length === 1 ? '' : 's'}
                </Badge>
              </div>
              <Separator className="my-3" />
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Default yield</span>
                  <span className="font-medium">{formValues.default_yield} {formValues.default_yield_unit}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Prep time</span>
                  <span className="font-medium">{formValues.prep_time_minutes ?? 0} min</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Output item</span>
                  <span className="font-medium truncate max-w-[180px] text-right">
                    {formValues.output_product_id ? (productLookup.get(formValues.output_product_id)?.name || 'Selected') : 'Not set'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="sticky bottom-0 z-10 border-t bg-background/95 px-6 py-4 backdrop-blur flex-col sm:flex-row sm:justify-end sm:space-x-2 gap-2">
            <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2 sm:items-center">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="w-full sm:w-auto">
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saving || !formValues.name} className="w-full sm:w-auto">
                {editingRecipe ? 'Save changes' : 'Create recipe'}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
