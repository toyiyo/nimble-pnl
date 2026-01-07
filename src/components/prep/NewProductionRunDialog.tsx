import { useEffect, useMemo, useState } from 'react';
import { PrepRecipe } from '@/hooks/usePrepRecipes';
import { IngredientUnit, MEASUREMENT_UNITS } from '@/lib/recipeUnits';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { format } from 'date-fns';
import { toast } from '@/hooks/use-toast';

interface NewProductionRunDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly prepRecipes: PrepRecipe[];
  readonly onCreate: (params: { prep_recipe: PrepRecipe; target_yield: number; target_yield_unit: IngredientUnit; scheduled_for?: string; notes?: string }) => Promise<void>;
}

export function NewProductionRunDialog({ open, onOpenChange, prepRecipes, onCreate }: NewProductionRunDialogProps) {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('');
  const [targetYield, setTargetYield] = useState<number>(1);
  const [targetUnit, setTargetUnit] = useState<IngredientUnit>('unit');
  const [scheduledFor, setScheduledFor] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState(false);
const selectedRecipe = useMemo(
  () => prepRecipes.find((recipe) => recipe.id === selectedRecipeId) || (prepRecipes.length > 0 ? prepRecipes[0] : null),
  [prepRecipes, selectedRecipeId]
);

  useEffect(() => {
    if (selectedRecipe) {
      setTargetYield(selectedRecipe.default_yield || 1);
      setTargetUnit(selectedRecipe.default_yield_unit || 'unit');
    }
  }, [selectedRecipe, open]);

  const scaledIngredients = useMemo(() => {
    if (!selectedRecipe) return [];
    const scale = selectedRecipe.default_yield > 0 ? targetYield / selectedRecipe.default_yield : 1;
    return (selectedRecipe.ingredients || []).map((ing) => ({
      ...ing,
      expected_quantity: (ing.quantity || 0) * scale,
    }));
  }, [selectedRecipe, targetYield]);

  const handleCreate = async () => {
    if (!selectedRecipe) return;
    setSaving(true);
    try {
      await onCreate({
        prep_recipe: selectedRecipe,
        target_yield: targetYield,
        target_yield_unit: targetUnit,
        scheduled_for: scheduledFor || undefined,
        notes,
      });
    } catch (error) {
      console.error('Failed to create production run:', error);
      toast({
        title: 'Failed to create batch',
        description: 'An error occurred while creating the production run. Please try again.',
        variant: 'destructive',
      });
      throw error; // Re-throw to allow parent components to handle if needed
    } finally {
      setSaving(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl h-[90dvh] max-h-[90dvh] overflow-hidden p-0 flex flex-col">
        <div className="sticky top-0 z-10 border-b bg-background/95 px-6 py-4 backdrop-blur">
          <DialogHeader>
            <DialogTitle>New Batch</DialogTitle>
            <DialogDescription>Create a production run and auto-scale ingredients from the recipe.</DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Prep recipe</Label>
              <Select value={selectedRecipe?.id || ''} onValueChange={setSelectedRecipeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a prep recipe" />
                </SelectTrigger>
                <SelectContent>
                  {prepRecipes.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Scheduled for</Label>
              <Input
                type="datetime-local"
                value={scheduledFor}
                min={format(new Date(), "yyyy-MM-dd'T'HH:mm")}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Target yield</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={targetYield}
                onChange={(e) => setTargetYield(Number.parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1">
              <Label>Unit</Label>
              <Select value={targetUnit} onValueChange={(value) => setTargetUnit(value as IngredientUnit)}>
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
            <div className="space-y-1">
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Special instructions" />
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-medium">Ingredient plan</p>
                <p className="text-xs text-muted-foreground">
                  Auto-scaled from recipe (factor {selectedRecipe?.default_yield ? (targetYield / selectedRecipe.default_yield).toFixed(2) : '1.00'})
                </p>
              </div>
              <Badge variant="outline">
                Yields {targetYield} {targetUnit}
              </Badge>
            </div>

            <ScrollArea className="max-h-48 pr-2">
              <div className="space-y-2">
                {scaledIngredients.map((ing) => (
                  <div key={ing.product_id} className="flex items-center justify-between text-sm">
                    <div className="font-medium">{ing.product?.name || 'Ingredient'}</div>
                    <div className="text-muted-foreground">
                      {ing.expected_quantity?.toFixed(2)} {ing.unit}
                    </div>
                  </div>
                ))}
                {scaledIngredients.length === 0 && (
                  <div className="text-sm text-muted-foreground">No ingredients defined on this recipe yet.</div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 border-t bg-background/95 px-6 py-4 backdrop-blur flex-col sm:flex-row sm:justify-end sm:space-x-2 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !selectedRecipe} className="w-full sm:w-auto">
            Create batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
