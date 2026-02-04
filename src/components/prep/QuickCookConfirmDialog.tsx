import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { QuickCookPreview } from '@/hooks/useQuickCook';
import { AlertTriangle, CheckCircle2, ChefHat, Package, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickCookConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly preview: QuickCookPreview | null;
  readonly onConfirm: () => void;
  readonly loading: boolean;
}

export function QuickCookConfirmDialog({
  open,
  onOpenChange,
  preview,
  onConfirm,
  loading,
}: Readonly<QuickCookConfirmDialogProps>) {
  const insufficientIngredients = useMemo(() => {
    if (!preview) return [];
    return preview.ingredients_to_deduct.filter((ing) => !ing.is_sufficient);
  }, [preview]);

  if (!preview) return null;

  const costPerUnit = preview.output_quantity > 0
    ? preview.total_cost / preview.output_quantity
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ChefHat className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>Cook Now: {preview.recipe.name}</DialogTitle>
              <DialogDescription>
                Preparing at 1X yield ({preview.output_quantity} {preview.output_unit})
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Stock Warning */}
          {preview.has_insufficient_stock && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                <p className="font-medium">Low Stock Warning</p>
                <p className="text-sm mt-1">
                  {insufficientIngredients.length} ingredient{insufficientIngredients.length === 1 ? '' : 's'} below required quantity. Stock will go negative if you proceed.
                </p>
              </AlertDescription>
            </Alert>
          )}

          {/* Ingredients to Deduct */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Minus className="h-4 w-4 text-destructive" />
              <p className="text-sm font-semibold">Will Deduct</p>
              <Badge variant="secondary" className="ml-auto">
                {preview.ingredients_to_deduct.length} item{preview.ingredients_to_deduct.length === 1 ? '' : 's'}
              </Badge>
            </div>

            <ScrollArea className="h-[180px] rounded-lg border">
              <div className="divide-y">
                {preview.ingredients_to_deduct.map((ing) => (
                  <div
                    key={ing.product_id}
                    className={cn(
                      'flex items-center justify-between p-3',
                      !ing.is_sufficient && 'bg-amber-50'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {ing.is_sufficient ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{ing.product_name}</p>
                        <p className="text-xs text-muted-foreground">
                          Stock: {ing.current_stock.toFixed(2)} {ing.stock_unit}
                        </p>
                      </div>
                    </div>
                    <Badge
                      variant={ing.is_sufficient ? 'outline' : 'destructive'}
                      className="shrink-0 ml-2 tabular-nums"
                    >
                      -{ing.quantity.toFixed(2)} {ing.unit}
                    </Badge>
                  </div>
                ))}
                {preview.ingredients_to_deduct.length === 0 && (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No ingredients to deduct
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <Separator />

          {/* Output to Add */}
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Plus className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Will Add</p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100">
                  <Package className="h-4 w-4 text-emerald-700" />
                </div>
                <div>
                  <p className="font-medium text-emerald-900 text-sm">{preview.output_product_name}</p>
                  {!preview.output_product_id && (
                    <p className="text-xs text-emerald-700">Will auto-create product</p>
                  )}
                  {preview.total_cost > 0 && (
                    <p className="text-xs text-emerald-700">
                      Cost: ${preview.total_cost.toFixed(2)} (${costPerUnit.toFixed(2)}/{preview.output_unit})
                    </p>
                  )}
                </div>
              </div>
              <Badge variant="outline" className="border-emerald-600 text-emerald-700 tabular-nums">
                +{preview.output_quantity} {preview.output_unit}
              </Badge>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={loading} className="gap-2">
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                Cooking...
              </>
            ) : (
              <>
                <ChefHat className="h-4 w-4" />
                Cook Now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
