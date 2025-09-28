import React from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Control } from 'react-hook-form';
import { Product } from '@/hooks/useProducts';
import { RecipeConversionInfo } from './RecipeConversionInfo';
import { suggestRecipeUnits } from '@/lib/unitConversion';

interface RecipeIngredientItemProps {
  index: number;
  control: Control<any>;
  products: Product[];
  onRemove: () => void;
  showConversionDetails: boolean;
  toggleConversionDetails: () => void;
  measurementUnits: string[];
}

export function RecipeIngredientItem({
  index,
  control,
  products,
  onRemove,
  showConversionDetails,
  toggleConversionDetails,
  measurementUnits
}: RecipeIngredientItemProps) {
  // Get the currently selected product for smart unit suggestions
  const productField = control._getWatch(`ingredients.${index}.product_id`);
  const selectedProduct = products.find(p => p.id === productField);
  
  return (
    <div className="flex flex-col gap-4 p-4 border rounded-lg bg-card">
      <div className="flex flex-wrap gap-4">
        <FormField
          control={control}
          name={`ingredients.${index}.product_id`}
          render={({ field }) => (
            <FormItem className="flex-1 min-w-[200px]">
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
                        {product.cost_per_unit && (
                          <span className="text-xs text-muted-foreground">
                            ${product.cost_per_unit.toFixed(2)}/{product.uom_purchase || 'unit'}
                            {product.conversion_factor && product.conversion_factor !== 1 && (
                              <> • ${(product.cost_per_unit / product.conversion_factor).toFixed(3)}/{product.uom_recipe || 'recipe unit'}</>
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
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {(() => {
                      if (selectedProduct?.uom_purchase) {
                        // Show smart suggestions based on product's purchase unit
                        const suggested = suggestRecipeUnits(selectedProduct.uom_purchase);
                        return suggested.map((unit, idx) => (
                          <SelectItem key={unit} value={unit}>
                            {unit} {idx === 0 ? '(recommended)' : ''}
                          </SelectItem>
                        ));
                      }
                      // Fallback to all measurement units
                      return measurementUnits.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ));
                    })()}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          
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