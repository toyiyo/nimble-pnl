import { useMemo } from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SearchableProductSelector } from '@/components/SearchableProductSelector';
import { Trash2, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { Control } from 'react-hook-form';
import { Product } from '@/hooks/useProducts';
import { RecipeConversionInfo } from './RecipeConversionInfo';
import { calculateInventoryImpact, getProductUnitInfo } from '@/lib/enhancedUnitConversion';
import { GroupedUnitSelector } from '@/components/GroupedUnitSelector';
import { computeLineCost, YIELD_REVIEW_BELOW } from '@/lib/recipeYield';

interface RecipeIngredientItemProps {
  index: number;
  control: Control<any>;
  products: Product[];
  onRemove: () => void;
  showConversionDetails: boolean;
  toggleConversionDetails: () => void;
  measurementUnits: readonly string[];
  onCreateNewProduct?: () => void;
  onEditProduct?: (product: Product) => void;
}

export function RecipeIngredientItem({
  index,
  control,
  products,
  onRemove,
  showConversionDetails,
  toggleConversionDetails,
  measurementUnits,
  onCreateNewProduct,
  onEditProduct,
}: RecipeIngredientItemProps) {
  // Get the currently selected product for smart unit suggestions
  const productField = control._getWatch(`ingredients.${index}.product_id`);
  const quantityField = control._getWatch(`ingredients.${index}.quantity`);
  const unitField = control._getWatch(`ingredients.${index}.unit`);
  const yieldOverrideField = control._getWatch(`ingredients.${index}.yield_pct_override`);
  const safeProducts = products ?? [];
  const selectedProduct = safeProducts.find(p => p.id === productField);

  // Loaded (post-waste) line cost, mirroring the SQL deduction's yield math.
  const lineCost = useMemo(() => {
    if (!quantityField || !unitField) {
      return null;
    }
    return computeLineCost(
      { quantity: quantityField, unit: unitField, yield_pct_override: yieldOverrideField ?? null },
      selectedProduct
    );
  }, [quantityField, unitField, yieldOverrideField, selectedProduct]);
  
  // Check for conversion issues
  const conversionIssue = useMemo(() => {
    if (!selectedProduct || !quantityField || !unitField) {
      return null;
    }

    const { purchaseUnit, sizeValue, sizeUnit, quantityPerPurchaseUnit } = 
      getProductUnitInfo(selectedProduct);

    // Check if units match (1:1 scenario)
    if (unitField.toLowerCase() === purchaseUnit.toLowerCase()) {
      return null; // No conversion needed
    }

    // Try to calculate conversion
    try {
      calculateInventoryImpact(
        quantityField,
        unitField,
        quantityPerPurchaseUnit,
        purchaseUnit,
        selectedProduct.name || '',
        selectedProduct.cost_per_unit || 0,
        sizeValue,
        sizeUnit
      );
      return null; // Conversion succeeded
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      if (errorMessage.includes('size information') || 
          errorMessage.includes('size_value and size_unit')) {
        return {
          type: 'missing_size' as const,
          message: `Missing size info for ${purchaseUnit}`
        };
      } else if (errorMessage.includes('not compatible with the recipe unit')) {
        return {
          type: 'incompatible' as const,
          message: `Can't convert ${unitField} to ${sizeUnit || purchaseUnit}`
        };
      }
      return {
        type: 'fallback' as const,
        message: 'Will use 1:1 deduction'
      };
    }
  }, [selectedProduct, quantityField, unitField]);
  
  return (
    <div className={`flex flex-col gap-4 p-4 border rounded-lg ${conversionIssue ? 'bg-amber-50/50 border-amber-300' : 'bg-card'}`}>
      {conversionIssue && (
        <div className="flex items-start gap-2 p-3 bg-amber-100 border border-amber-300 rounded-md">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800">Conversion Warning</p>
            <p className="text-sm text-amber-700">{conversionIssue.message}</p>
            <p className="text-xs text-amber-600 mt-1">
              Inventory will be deducted 1:1 (e.g., 1 {unitField} = 1 {selectedProduct?.uom_purchase || 'unit'})
            </p>
            {onEditProduct && selectedProduct && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 h-7 px-2 text-xs"
                onClick={() => onEditProduct(selectedProduct)}
              >
                Edit inventory details
              </Button>
            )}
          </div>
          <Badge variant="outline" className="bg-amber-200 text-amber-800 border-amber-400 text-xs whitespace-nowrap">
            1:1 Fallback
          </Badge>
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <FormField
          control={control}
          name={`ingredients.${index}.product_id`}
          render={({ field }) => (
            <FormItem className="flex-1 min-w-[200px]">
              <FormLabel>Product</FormLabel>
              <FormControl>
                <SearchableProductSelector
                  value={field.value}
                  onValueChange={field.onChange}
                  products={products}
                  showSkipOption={false}
                  onCreateNew={onCreateNewProduct}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex gap-2 items-end">
          <FormField
            control={control}
            name={`ingredients.${index}.quantity`}
            render={({ field }) => (
              <FormItem className="w-24">
                <FormLabel>Qty</FormLabel>
                <FormControl>
                  <Input 
                    type="number" 
                    step="0.001"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`ingredients.${index}.unit`}
            render={({ field }) => (
              <FormItem className="w-28">
                <FormLabel>Unit</FormLabel>
                <FormControl>
                  <GroupedUnitSelector
                    value={field.value}
                    onValueChange={field.onChange}
                    placeholder="Unit"
                    productName={selectedProduct?.name}
                    productSizeUnit={selectedProduct?.size_unit || selectedProduct?.uom_purchase}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          
          <FormField
            control={control}
            name={`ingredients.${index}.yield_pct_override`}
            render={({ field }) => (
              <FormItem className="w-20">
                <FormLabel>Yield</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      type="number"
                      min={50}
                      max={100}
                      step={1}
                      placeholder={String(selectedProduct?.yield_pct ?? 100)}
                      aria-label={`Yield percent for ${selectedProduct?.name ?? 'product'}`}
                      value={field.value ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        field.onChange(raw === '' ? null : Number(raw));
                      }}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                      %
                    </span>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="w-20 text-right">
            <FormLabel className="block">Cost</FormLabel>
            <div className="h-10 flex items-center justify-end text-[14px] font-medium tabular-nums">
              {lineCost ? `$${lineCost.loadedCost.toFixed(2)}` : '—'}
            </div>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      {selectedProduct && lineCost && (
        <div className="text-[13px] text-muted-foreground flex flex-wrap items-center gap-2">
          {(lineCost.source === 'override' || lineCost.yieldPct !== 100) && (
            lineCost.source === 'override' ? (
              <span className="px-1.5 py-0.5 rounded-md bg-muted text-foreground">
                {lineCost.yieldPct}% override · product {selectedProduct.yield_pct ?? 100}%
              </span>
            ) : (
              <span className="text-muted-foreground">
                {lineCost.yieldPct}% from product
              </span>
            )
          )}
          <span>
            Uses {lineCost.loadedQty.toFixed(2)} {unitField || 'unit'} from inventory per sale · portion ${lineCost.portionCost.toFixed(2)}
          </span>
          {lineCost.yieldPct < YIELD_REVIEW_BELOW && (
            <span className="px-1.5 py-0.5 rounded-md text-warning bg-warning/10 border border-warning/30">
              Low yield — review
            </span>
          )}
        </div>
      )}

      {selectedProduct && quantityField && unitField && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start pl-0 h-auto"
          onClick={toggleConversionDetails}
        >
          <span className="flex items-center gap-1">
            {showConversionDetails ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Hide conversion details
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Show conversion details
              </>
            )}
          </span>
        </Button>
      )}
      
      {showConversionDetails && (
        <FormField
          control={control}
          name={`ingredients.${index}.product_id`}
          render={({ field }) => {
            const product = products.find(p => p.id === field.value);
            if (!product) return null;
            
            return (
              <FormField
                control={control}
                name={`ingredients.${index}.quantity`}
                render={({ field: quantityField }) => (
                  <FormField
                    control={control}
                    name={`ingredients.${index}.unit`}
                    render={({ field: unitField }) => (
                      <RecipeConversionInfo 
                        product={product}
                        recipeQuantity={parseFloat(quantityField.value) || 0}
                        recipeUnit={unitField.value || 'unit'}
                      />
                    )}
                  />
                )}
              />
            );
          }}
        />
      )}
    </div>
  );
}
