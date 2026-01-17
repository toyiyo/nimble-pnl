import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { calculatePrepIngredientCost } from '@/lib/prepRecipeCosting';
import type { IngredientUnit } from '@/lib/recipeUnits';
import type { Product } from '@/hooks/useProducts';

type IngredientRow = {
  product_id: string;
  quantity: number;
  unit: IngredientUnit;
  notes?: string;
};

type IngredientField = keyof IngredientRow;

interface PrepRecipeIngredientRowProps {
  readonly ingredient: IngredientRow;
  readonly index: number;
  readonly products: Product[];
  readonly measurementUnits: readonly IngredientUnit[];
  readonly onChange: <K extends IngredientField>(index: number, field: K, value: IngredientRow[K]) => void;
  readonly onRemove: () => void;
  readonly onQuickFix: (product: Product) => void;
}

export function PrepRecipeIngredientRow({
  ingredient,
  index,
  products,
  measurementUnits,
  onChange,
  onRemove,
  onQuickFix,
}: PrepRecipeIngredientRowProps) {
  const [showDetails, setShowDetails] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === ingredient.product_id),
    [products, ingredient.product_id]
  );

  const hasValidInputs = Boolean(selectedProduct && ingredient.quantity > 0 && ingredient.unit);

  const costResult = useMemo(() => {
    if (hasValidInputs) {
      return calculatePrepIngredientCost({
        product: selectedProduct,
        quantity: ingredient.quantity,
        unit: ingredient.unit,
      });
    }
    return null;
  }, [hasValidInputs, selectedProduct, ingredient.quantity, ingredient.unit]);

  const purchaseUnit = selectedProduct?.uom_purchase || 'unit';
  const hasWarning = Boolean(costResult && costResult.status !== 'ok' && costResult.status !== 'missing_product');
  const costLabel = costResult?.cost != null ? `$${costResult.cost.toFixed(2)}` : '--';

  const warningBadge = useMemo(() => {
    if (hasWarning && costResult) {
      if (costResult.status === 'missing_cost') return 'Missing cost';
      if (costResult.status === 'missing_size') return 'Missing size';
      if (costResult.status === 'incompatible_units') return 'Unit mismatch';
      if (costResult.status === 'fallback') return 'Check units';
      return 'Needs review';
    }
    return null;
  }, [hasWarning, costResult]);

  const warningMessage = useMemo(() => {
    if (hasWarning && costResult) {
      if (costResult.status === 'missing_cost') {
        return 'Add a unit cost to calculate this ingredient.';
      }
      if (costResult.status === 'missing_size') {
        return `Add size info for ${purchaseUnit} to convert ${ingredient.unit}.`;
      }
      if (costResult.status === 'incompatible_units') {
        return `Update size unit so it matches ${ingredient.unit}.`;
      }
      if (costResult.status === 'fallback') {
        return 'Conversion used a fallback. Confirm unit setup.';
      }
      return 'Review conversion settings for this ingredient.';
    }
    return null;
  }, [hasWarning, costResult, purchaseUnit, ingredient.unit]);

  const conversionPath = costResult?.conversionDetails?.conversionPath?.filter(Boolean) ?? [];
  const conversionText = conversionPath.length ? conversionPath.join(' → ') : null;
  const canShowDetails = hasValidInputs;
  const showDetailsPanel = showDetails && canShowDetails;

  const quantityId = `prep-ingredient-quantity-${ingredient.product_id || index}`;
  const notesId = `prep-ingredient-notes-${ingredient.product_id || index}`;

  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm space-y-3">
      <div className="grid grid-cols-12 gap-2 items-center">
        <div className="col-span-12 sm:col-span-5 space-y-1">
          <Label>Product</Label>
          <Select value={ingredient.product_id} onValueChange={(value) => onChange(index, 'product_id', value)}>
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
          <Label htmlFor={quantityId}>Quantity</Label>
          <Input
            id={quantityId}
            type="number"
            min="0"
            step="0.01"
            value={ingredient.quantity}
            onChange={(e) => onChange(index, 'quantity', Number.parseFloat(e.target.value) || 0)}
          />
        </div>

        <div className="col-span-6 sm:col-span-3 space-y-1">
          <Label>Unit</Label>
          <Select value={ingredient.unit} onValueChange={(value) => onChange(index, 'unit', value as IngredientUnit)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {measurementUnits.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="col-span-12 sm:col-span-1 flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label="Remove ingredient"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Estimated cost</span>
        <div className="flex items-center gap-2">
          {warningBadge && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              {warningBadge}
            </Badge>
          )}
          <span className="font-medium text-foreground">{costLabel}</span>
        </div>
      </div>

      {hasWarning && selectedProduct && warningMessage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="font-medium">Conversion info needed</span>
          <span className="text-amber-700">{warningMessage}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto h-6 px-2 text-amber-800"
            onClick={() => onQuickFix(selectedProduct)}
          >
            Fix product
          </Button>
        </div>
      )}

      {canShowDetails && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start px-0"
          onClick={() => setShowDetails((prev) => !prev)}
        >
          <span className="flex items-center gap-1">
            {showDetails ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {showDetails ? 'Hide details' : 'Details'}
          </span>
        </Button>
      )}

      {showDetailsPanel && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground space-y-2">
          {costResult?.status === 'ok' && costResult.cost != null ? (
            <>
              {typeof costResult.inventoryDeduction === 'number' && costResult.inventoryDeductionUnit && (
                <div className="flex items-center justify-between gap-4">
                  <span>Inventory deduction</span>
                  <span className="font-medium text-foreground">
                    {costResult.inventoryDeduction.toFixed(3)} {costResult.inventoryDeductionUnit}
                  </span>
                </div>
              )}
              {conversionText && (
                <div className="flex items-center justify-between gap-4">
                  <span>Conversion</span>
                  <span className="text-foreground text-right">{conversionText}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <span>Purchase unit</span>
                <span className="text-foreground">{purchaseUnit}</span>
              </div>
              {selectedProduct?.size_value && selectedProduct?.size_unit && (
                <div className="flex items-center justify-between gap-4">
                  <span>Package size</span>
                  <span className="text-foreground">
                    {selectedProduct.size_value} {selectedProduct.size_unit} per {purchaseUnit}
                  </span>
                </div>
              )}
            </>
          ) : (
            <span>
              {costResult?.message || warningMessage || 'Update product details to calculate conversion.'}
            </span>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={notesId}>Notes</Label>
        <Input
          id={notesId}
          value={ingredient.notes || ''}
          onChange={(e) => onChange(index, 'notes', e.target.value)}
          placeholder="Prep notes, trim %, alternates"
        />
      </div>
    </div>
  );
}
