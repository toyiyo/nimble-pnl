import React, { useMemo } from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, Scale } from 'lucide-react';

interface SizePackagingSectionProps {
  form: any;
}

// Unit conversion utility functions
const convertUnits = (value: number, fromUnit: string, toUnit: string): number => {
  const conversions: { [key: string]: { [key: string]: number } } = {
    'oz': {
      'lb': 1/16,
      'g': 28.3495,
      'kg': 0.0283495
    },
    'lb': {
      'oz': 16,
      'g': 453.592,
      'kg': 0.453592
    },
    'kg': {
      'lb': 2.20462,
      'oz': 35.274,
      'g': 1000
    },
    'g': {
      'kg': 0.001,
      'oz': 0.035274,
      'lb': 0.00220462
    }
  };

  return conversions[fromUnit]?.[toUnit] ? value * conversions[fromUnit][toUnit] : value;
};

// Product-specific conversions for common ingredients
const getProductSpecificConversions = (productName: string, sizeValue: number, sizeUnit: string) => {
  const name = productName?.toLowerCase() || '';
  const conversions = [];

  if (name.includes('rice') && sizeUnit === 'oz') {
    // Rice-specific conversions: 1 cup rice = 180g = 6.3oz
    const cupsPerPackage = sizeValue / 6.3;
    const gramsPerPackage = cupsPerPackage * 180;
    
    conversions.push(
      { unit: 'cups', value: cupsPerPackage, note: 'uncooked rice' },
      { unit: 'servings', value: cupsPerPackage * 2, note: '1/2 cup per serving' }
    );
  }

  if (name.includes('flour') && sizeUnit === 'oz') {
    // Flour: 1 cup = 120g = 4.2oz
    const cupsPerPackage = sizeValue / 4.2;
    conversions.push(
      { unit: 'cups', value: cupsPerPackage, note: 'all-purpose flour' }
    );
  }

  if (name.includes('sugar') && sizeUnit === 'oz') {
    // Sugar: 1 cup = 200g = 7.05oz  
    const cupsPerPackage = sizeValue / 7.05;
    conversions.push(
      { unit: 'cups', value: cupsPerPackage, note: 'granulated sugar' }
    );
  }

  return conversions;
};

export function SizePackagingSection({ form }: SizePackagingSectionProps) {
  const sizeValue = form.watch('size_value') || 0;
  const purchaseUnit = form.watch('uom_purchase') || '';  // Use uom_purchase instead of size_unit
  const packageQty = form.watch('package_qty') || 1;
  const productName = form.watch('name') || '';

  // Calculate alternative units
  const alternativeUnits = useMemo(() => {
    if (!sizeValue || !purchaseUnit) return [];

    const alternatives = [];
    const totalValue = sizeValue * packageQty;

    // Weight conversions
    if (purchaseUnit === 'oz') {
      if (totalValue >= 16) {
        alternatives.push({ unit: 'lb', value: convertUnits(totalValue, 'oz', 'lb') });
      }
      alternatives.push({ unit: 'g', value: convertUnits(totalValue, 'oz', 'g') });
      if (totalValue * 28.3495 >= 1000) {
        alternatives.push({ unit: 'kg', value: convertUnits(totalValue, 'oz', 'kg') });
      }
    } 
    else if (purchaseUnit === 'lb') {
      alternatives.push({ unit: 'oz', value: convertUnits(totalValue, 'lb', 'oz') });
      alternatives.push({ unit: 'g', value: convertUnits(totalValue, 'lb', 'g') });
      alternatives.push({ unit: 'kg', value: convertUnits(totalValue, 'lb', 'kg') });
    }
    else if (purchaseUnit === 'kg') {
      alternatives.push({ unit: 'lb', value: convertUnits(totalValue, 'kg', 'lb') });
      alternatives.push({ unit: 'oz', value: convertUnits(totalValue, 'kg', 'oz') });
      alternatives.push({ unit: 'g', value: convertUnits(totalValue, 'kg', 'g') });
    }
    else if (purchaseUnit === 'g') {
      if (totalValue >= 1000) {
        alternatives.push({ unit: 'kg', value: convertUnits(totalValue, 'g', 'kg') });
      }
      alternatives.push({ unit: 'oz', value: convertUnits(totalValue, 'g', 'oz') });
      if (totalValue * 0.035274 >= 16) {
        alternatives.push({ unit: 'lb', value: convertUnits(totalValue, 'g', 'lb') });
      }
    }

    return alternatives;
  }, [sizeValue, purchaseUnit, packageQty]);

  // Get product-specific conversions
  const productConversions = useMemo(() => {
    return getProductSpecificConversions(productName, sizeValue * packageQty, purchaseUnit);
  }, [productName, sizeValue, packageQty, purchaseUnit]);

  return (
    <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
      <h4 className="font-medium text-sm flex items-center gap-2">
        <Package className="h-4 w-4" />
        Size & Packaging Details
      </h4>
      
      {/* Clear explanation */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
        <p className="text-sm text-blue-800 mb-2">
          <strong>How to enter package information:</strong>
        </p>
        <div className="text-xs text-blue-700 space-y-1">
          <div>• <strong>Weight per unit:</strong> How much does ONE item weigh? (e.g., 80 for an 80oz bag)</div>
          <div>• <strong>Unit:</strong> What unit is that weight in? (e.g., oz, lb, kg)</div>
          <div>• <strong>Quantity:</strong> How many of those items are you buying? (e.g., 1 bag, 6 bottles)</div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <FormField
          control={form.control}
          name="size_value"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Weight per unit
                <span className="text-xs text-muted-foreground font-normal">(per bag, bottle, etc.)</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="0.01"
                  placeholder="80"
                  className="text-center"
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">Enter the weight of ONE item</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="uom_purchase"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Unit
                <span className="text-xs text-muted-foreground font-normal">(weight measurement)</span>
              </FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="oz" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="oz">oz (ounces)</SelectItem>
                  <SelectItem value="lb">lb (pounds)</SelectItem>
                  <SelectItem value="g">g (grams)</SelectItem>
                  <SelectItem value="kg">kg (kilograms)</SelectItem>
                  <SelectItem value="ml">ml (milliliters)</SelectItem>
                  <SelectItem value="L">L (liters)</SelectItem>
                  <SelectItem value="gal">gal (gallons)</SelectItem>
                  <SelectItem value="qt">qt (quarts)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">The unit of measurement</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="package_qty"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Quantity
                <span className="text-xs text-muted-foreground font-normal">(how many items)</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  min="1"
                  placeholder="1"
                  className="text-center"
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">Number of bags, bottles, etc.</p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      
      {/* Live example */}
      {sizeValue && purchaseUnit && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-medium text-green-800">✓ Example interpretation:</Label>
          </div>
          <div className="text-sm text-green-700">
            You're buying <strong>{packageQty}</strong> item{packageQty !== 1 ? 's' : ''}, 
            each weighing <strong>{sizeValue} {purchaseUnit}</strong>
            {packageQty > 1 && (
              <span>, for a total of <strong>{(sizeValue * packageQty).toFixed(2)} {purchaseUnit}</strong></span>
            )}
          </div>
          <div className="text-xs text-green-600 mt-1">
            Example: "1 bag weighing 80 oz" or "6 bottles, each 16 oz = 96 oz total"
          </div>
        </div>
      )}

      {/* Package Summary */}
      {sizeValue && purchaseUnit && (
        <div className="p-3 bg-background border rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-medium">Package Summary</Label>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              Total: {packageQty} × {sizeValue} {purchaseUnit} = {(sizeValue * packageQty).toFixed(2)} {purchaseUnit}
            </div>
            
            {/* Alternative units */}
            {alternativeUnits.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-xs font-medium">Also equals:</span>
                {alternativeUnits.map((alt, idx) => (
                  <Badge key={idx} variant="secondary" className="text-xs">
                    {alt.value.toFixed(alt.value < 1 ? 3 : 2)} {alt.unit}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Product-specific conversions */}
      {productConversions.length > 0 && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="h-4 w-4 text-blue-600" />
            <Label className="text-sm font-medium text-blue-800">Recipe Measurements</Label>
          </div>
          <div className="flex flex-wrap gap-2">
            {productConversions.map((conv, idx) => (
              <Badge key={idx} variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                {conv.value.toFixed(1)} {conv.unit}
                {conv.note && (
                  <span className="ml-1 text-xs opacity-75">({conv.note})</span>
                )}
              </Badge>
            ))}
          </div>
          <p className="text-xs text-blue-600 mt-2">
            These conversions help you understand how many recipe portions this package contains.
          </p>
        </div>
      )}

      {/* Recipe conversion examples */}
      {productName.toLowerCase().includes('rice') && sizeValue && purchaseUnit === 'oz' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <Label className="text-sm font-medium text-green-800 mb-2 block">
            Recipe Impact Example
          </Label>
          <div className="text-xs text-green-700 space-y-1">
            <div>• 1 cup of rice = 6.3 oz = {((6.3 / (sizeValue * packageQty)) * 100).toFixed(1)}% of this package</div>
            <div>• Cost per cup = ${((6.3 / (sizeValue * packageQty)) * (form.watch('cost_per_unit') || 0)).toFixed(2)} (if package costs ${(form.watch('cost_per_unit') || 0).toFixed(2)})</div>
            <div>• Package contains ~{((sizeValue * packageQty) / 6.3).toFixed(1)} cups of rice</div>
          </div>
        </div>
      )}
    </div>
  );
}