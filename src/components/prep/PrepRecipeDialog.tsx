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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PrepRecipeFormValues) => Promise<void>;
  products: Product[];
  editingRecipe?: PrepRecipe | null;
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

  const ingredientRows = useMemo(
    () => [...formValues.ingredients].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [formValues.ingredients]
  );

  const handleIngredientChange = (index: number, field: keyof PrepRecipeFormValues['ingredients'][number], value: any) => {
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
    await onSubmit({
      ...formValues,
      output_product_id: formValues.output_product_id || undefined,
      ingredients: formValues.ingredients.filter((ing) => ing.product_id),
    });
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editingRecipe ? 'Edit Prep Recipe' : 'New Prep Recipe'}</DialogTitle>
          <DialogDescription>
            Define the blueprint for a prep item. Ingredients here do not move inventory until a batch is completed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
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
                    setFormValues({ ...formValues, default_yield: parseFloat(e.target.value) || 0 })
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
                      prep_time_minutes: e.target.value ? parseInt(e.target.value, 10) : null,
                    })
                  }
                  placeholder="45"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Ingredients</Label>
                <p className="text-xs text-muted-foreground">Expected amounts for one default batch</p>
              </div>
              <Button variant="outline" size="sm" onClick={addIngredientRow}>
                <Plus className="h-4 w-4 mr-2" />
                Add ingredient
              </Button>
            </div>

            <ScrollArea className="max-h-[320px] pr-2">
              <div className="space-y-3">
                {ingredientRows.map((ingredient, index) => (
                  <div key={index} className="rounded-lg border bg-card p-3 shadow-sm space-y-3">
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
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={ingredient.quantity}
                          onChange={(e) => handleIngredientChange(index, 'quantity', parseFloat(e.target.value) || 0)}
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

        <DialogFooter className="flex-col sm:flex-row sm:justify-end sm:space-x-2 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !formValues.name}>
            {editingRecipe ? 'Save changes' : 'Create recipe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
