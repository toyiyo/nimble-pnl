import { useEffect, useMemo, useState } from 'react';
import { ProductionRun, ProductionRunIngredient, ProductionRunStatus } from '@/hooks/useProductionRuns';
import { IngredientUnit, MEASUREMENT_UNITS } from '@/lib/recipeUnits';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CalendarClock, CheckCircle2, DollarSign, Loader2, Package, UtensilsCrossed } from 'lucide-react';

interface ProductionRunDetailDialogProps {
  readonly run: ProductionRun | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: (payload: {
    runId: string;
    actual_yield?: number;
    actual_yield_unit?: IngredientUnit;
    status?: ProductionRunStatus;
    ingredients: Array<{
      id?: string;
      product_id: string;
      expected_quantity?: number | null;
      actual_quantity?: number | null;
      unit?: IngredientUnit | null;
    }>;
  }) => Promise<void>;
  readonly saving?: boolean;
}

const STATUS_BADGES: Record<ProductionRunStatus, { label: string; variant: 'default' | 'outline'; tone: string }> = {
  planned: { label: 'Planned', variant: 'outline', tone: 'text-blue-700 bg-blue-100 border-blue-200' },
  in_progress: { label: 'In Progress', variant: 'default', tone: 'bg-amber-100 text-amber-800 border-amber-200' },
  completed: { label: 'Completed', variant: 'default', tone: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  cancelled: { label: 'Cancelled', variant: 'outline', tone: 'text-muted-foreground' },
  draft: { label: 'Draft', variant: 'outline', tone: 'text-muted-foreground' },
};

export function ProductionRunDetailDialog({ run, open, onOpenChange, onSave, saving }: ProductionRunDetailDialogProps) {
  const [actualYield, setActualYield] = useState<number | ''>('');
  const [actualUnit, setActualUnit] = useState<IngredientUnit>('unit');
  const [status, setStatus] = useState<ProductionRunStatus>('planned');
  const [ingredientActuals, setIngredientActuals] = useState<ProductionRunIngredient[]>([]);

  useEffect(() => {
    if (run) {
      setActualYield(run.actual_yield ?? run.target_yield ?? '');
      setActualUnit(run.actual_yield_unit ?? run.target_yield_unit ?? 'unit');
      setStatus(run.status);
      setIngredientActuals(run.ingredients || []);
    }
  }, [run, open]);

  const avgVariance = useMemo(() => {
    const withExpected = ingredientActuals.filter((ing) => ing.expected_quantity);
    if (!withExpected.length) return 0;
    const varianceSum = withExpected.reduce((sum, ing) => {
      const expected = ing.expected_quantity || 0;
      const actual = ing.actual_quantity || 0;
      if (!expected) return sum;
      return sum + ((actual - expected) / expected) * 100;
    }, 0);
    return varianceSum / withExpected.length;
  }, [ingredientActuals]);

  const projectedCosts = useMemo(() => {
    // Handle null run
    if (!run) {
      return { costPerUnit: null, totalCost: null };
    }

    // For completed batches, use the stored values
    if (run.status === 'completed') {
      return {
        costPerUnit: run.cost_per_unit,
        totalCost: run.actual_total_cost,
      };
    }

    // For in-progress batches, calculate projected costs
    const yieldValue = actualYield ? Number(actualYield) : (run.target_yield || 0);
    if (yieldValue === 0 || ingredientActuals.length === 0) {
      return { costPerUnit: null, totalCost: null };
    }

    // Calculate total ingredient cost based on actual quantities (or expected if no actuals)
    const totalIngredientCost = ingredientActuals.reduce((sum, ing) => {
      const quantity = ing.actual_quantity ?? ing.expected_quantity ?? 0;
      const costPerUnit = ing.product?.cost_per_unit || 0;
      return sum + (quantity * costPerUnit);
    }, 0);

    const costPerUnit = totalIngredientCost / yieldValue;

    return {
      costPerUnit: totalIngredientCost > 0 ? costPerUnit : null,
      totalCost: totalIngredientCost > 0 ? totalIngredientCost : null,
    };
  }, [run?.status, run?.cost_per_unit, run?.actual_total_cost, run?.target_yield, actualYield, ingredientActuals]);

  // Early return for null run - after all hooks have been called
  if (!run) {
    return null;
  }

  const handleSave = async (finalStatus?: ProductionRunStatus) => {
    await onSave({
      runId: run.id,
      actual_yield: actualYield !== '' ? Number(actualYield) : undefined,
      actual_yield_unit: actualUnit,
      status: finalStatus || status,
      ingredients: ingredientActuals.map((ing) => ({
        id: ing.id,
        product_id: ing.product_id,
        expected_quantity: ing.expected_quantity,
        actual_quantity: ing.actual_quantity,
        unit: ing.unit,
      })),
    });
    if (finalStatus) {
      setStatus(finalStatus);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <UtensilsCrossed className="h-5 w-5 text-primary" />
            {run.prep_recipe?.name || 'Batch'}
            <Badge variant="outline" className={STATUS_BADGES[status].tone}>
              {STATUS_BADGES[status].label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Track actual usage and yield to keep inventory and variance aligned with reality.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="actual-yield">Actual yield</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="actual-yield"
                    type="number"
                    min="0"
                    step="0.01"
                    value={actualYield}
                    onChange={(e) => setActualYield(e.target.value ? parseFloat(e.target.value) : '')}
                    aria-describedby="actual-yield-hint"
                  />
                  <Select value={actualUnit} onValueChange={(value) => setActualUnit(value as IngredientUnit)}>
                    <SelectTrigger className="w-28" aria-label="Yield unit">
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
                <p id="actual-yield-hint" className="text-xs text-muted-foreground">
                  Target: {run.target_yield} {run.target_yield_unit}
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="status-select">Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as ProductionRunStatus)}>
                  <SelectTrigger id="status-select" aria-label="Production run status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['planned', 'in_progress', 'completed', 'cancelled'] as ProductionRunStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_BADGES[s].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-semibold">Ingredient usage</p>
                  <p className="text-xs text-muted-foreground">Adjust actuals to record over/under usage</p>
                </div>
                <Badge variant="outline">Avg variance {avgVariance.toFixed(1)}%</Badge>
              </div>

              <ScrollArea className="max-h-80 pr-2">
                <div className="space-y-3">
                  {ingredientActuals.map((ing, idx) => {
                    const expected = ing.expected_quantity || 0;
                    const actual = ing.actual_quantity || 0;
                    const variance = expected ? ((actual - expected) / expected) * 100 : 0;
                    const progressValue = expected ? Math.min((actual / expected) * 100, 200) : 0;

                    return (
                      <div key={ing.id || idx} className="p-3 rounded-lg bg-card border">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium">{ing.product?.name || 'Ingredient'}</div>
                          <Badge variant="outline" className={Math.abs(variance) > 5 ? 'text-amber-700 border-amber-200 bg-amber-50' : 'text-emerald-700 border-emerald-200 bg-emerald-50'}>
                            {variance > 0 ? '+' : ''}
                            {variance.toFixed(1)}%
                          </Badge>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                          <div className="text-sm text-muted-foreground">
                            Expected: {expected.toFixed(2)} {ing.unit}
                          </div>
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={actual}
                              aria-label={`Actual quantity for ${ing.product?.name || 'ingredient'}`}
                              onChange={(e) => {
                                const updated = [...ingredientActuals];
                                updated[idx] = { ...ing, actual_quantity: parseFloat(e.target.value) || 0 };
                                setIngredientActuals(updated);
                              }}
                            />
                            <Badge variant="outline">{ing.unit}</Badge>
                          </div>
                        </div>
                        <Progress value={progressValue} className="h-2" />
                      </div>
                    );
                  })}

                  {ingredientActuals.length === 0 && (
                    <div className="text-sm text-muted-foreground">No ingredients recorded for this batch.</div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  <span>Cost per unit</span>
                </div>
                <span className="font-semibold">
                  {projectedCosts.costPerUnit == null ? '—' : `$${projectedCosts.costPerUnit.toFixed(2)}`}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Total batch cost</span>
                <span className="font-medium text-foreground">
                  {projectedCosts.totalCost == null ? '—' : `$${projectedCosts.totalCost.toFixed(2)}`}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {run.status === 'completed' ? 'Costs locked when batch was completed.' : 'Projected costs based on current actuals. Costs lock when you complete the batch.'}
              </p>
            </div>

            <div className="rounded-lg border bg-card p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarClock className="h-4 w-4" />
                <span>Scheduled</span>
                <span className="font-medium text-foreground">
                  {run.scheduled_for ? new Date(run.scheduled_for).toLocaleString() : 'Not scheduled'}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Package className="h-4 w-4" />
                <span>Output item</span>
                <span className="font-medium text-foreground">
                  {run.prep_recipe?.output_product?.name || 'Not mapped'}
                </span>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
              <p className="font-semibold text-sm">Completion playbook</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li>Review actual vs expected usage above</li>
                <li>Mark status to completed to lock the batch</li>
                <li>Completion will deduct ingredients and add output to inventory</li>
              </ul>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Close
          </Button>
          <Button variant="secondary" onClick={() => handleSave(status)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Save as {STATUS_BADGES[status].label}
          </Button>
          <Button onClick={() => handleSave('completed')} disabled={saving}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Complete batch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
