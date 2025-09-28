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
  const sizeUnit = form.watch('size_unit') || '';  // Weight unit (oz, lb, etc.)
  const purchaseUnit = form.watch('uom_purchase') || '';  // Package type (bag, case, etc.)
  const productName = form.watch('name') || '';
  
  // Set package_qty to equal size_value (base units per package)
  React.useEffect(() => {
    form.setValue('package_qty', sizeValue || 1);
  }, [sizeValue, form]);

  // Calculate alternative units  
  const alternativeUnits = useMemo(() => {
    if (!sizeValue || !sizeUnit) return [];

    const alternatives = [];
    const totalValue = sizeValue; // Just the size per package

    // Weight conversions
    if (sizeUnit === 'oz') {
      if (totalValue >= 16) {
        alternatives.push({ unit: 'lb', value: convertUnits(totalValue, 'oz', 'lb') });
      }
      alternatives.push({ unit: 'g', value: convertUnits(totalValue, 'oz', 'g') });
      if (totalValue * 28.3495 >= 1000) {
        alternatives.push({ unit: 'kg', value: convertUnits(totalValue, 'oz', 'kg') });
      }
    } 
    else if (sizeUnit === 'lb') {
      alternatives.push({ unit: 'oz', value: convertUnits(totalValue, 'lb', 'oz') });
      alternatives.push({ unit: 'g', value: convertUnits(totalValue, 'lb', 'g') });
      alternatives.push({ unit: 'kg', value: convertUnits(totalValue, 'lb', 'kg') });
    }
    else if (sizeUnit === 'kg') {
      alternatives.push({ unit: 'lb', value: convertUnits(totalValue, 'kg', 'lb') });
      alternatives.push({ unit: 'oz', value: convertUnits(totalValue, 'kg', 'oz') });
      alternatives.push({ unit: 'g', value: convertUnits(totalValue, 'kg', 'g') });
    }
    else if (sizeUnit === 'g') {
      if (totalValue >= 1000) {
        alternatives.push({ unit: 'kg', value: convertUnits(totalValue, 'g', 'kg') });
      }
      alternatives.push({ unit: 'oz', value: convertUnits(totalValue, 'g', 'oz') });
      if (totalValue * 0.035274 >= 16) {
        alternatives.push({ unit: 'lb', value: convertUnits(totalValue, 'g', 'lb') });
      }
    }

    return alternatives;
  }, [sizeValue, sizeUnit]);

  // Get product-specific conversions
  const productConversions = useMemo(() => {
    return getProductSpecificConversions(productName, sizeValue, sizeUnit);
  }, [productName, sizeValue, sizeUnit]);

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
          <div>• <strong>Amount:</strong> How much is in ONE package? (e.g., 80 for an 80oz bag)</div>
          <div>• <strong>Weight Unit:</strong> What unit is that amount in? (e.g., oz, lb, kg)</div>
          <div>• <strong>Package Type:</strong> What kind of package are you buying? (e.g., bag, case, bottle)</div>
          <div>• <strong>Quantity:</strong> How many packages are you buying? (e.g., 1 bag, 6 bottles)</div>
        </div>
        <div className="text-xs text-blue-600 mt-2 font-medium">
          Example: "1 bag containing 80 oz of rice" = Amount: 80, Unit: oz, Type: bag, Quantity: 1
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <FormField
          control={form.control}
          name="size_value"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Amount
                <span className="text-xs text-muted-foreground font-normal">(per package)</span>
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
              <p className="text-xs text-muted-foreground">Amount in each package</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="size_unit"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                Weight Unit
                <span className="text-xs text-muted-foreground font-normal">(measurement)</span>
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
              <p className="text-xs text-muted-foreground">Unit of measurement</p>
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
                Package Type
                <span className="text-xs text-muted-foreground font-normal">(what you buy)</span>
              </FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="bag" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="bag">bag</SelectItem>
                  <SelectItem value="case">case</SelectItem>
                  <SelectItem value="box">box</SelectItem>
                  <SelectItem value="bottle">bottle</SelectItem>
                  <SelectItem value="can">can</SelectItem>
                  <SelectItem value="jar">jar</SelectItem>
                  <SelectItem value="pack">pack</SelectItem>
                  <SelectItem value="unit">unit</SelectItem>
                  <SelectItem value="each">each</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Type of package you buy</p>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Hidden field to store base units per package */}
        <input 
          type="hidden" 
          {...form.register('package_qty')}
          value={sizeValue || 1}
        />
      </div>
      
      {/* Live example */}
      {sizeValue && sizeUnit && purchaseUnit && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-medium text-green-800">✓ Package definition:</Label>
          </div>
          <div className="text-sm text-green-700">
            Each <strong>{purchaseUnit}</strong> contains <strong>{sizeValue} {sizeUnit}</strong>
          </div>
          <div className="text-xs text-green-600 mt-1">
            Example: "1 bottle containing 750 ml" or "1 bag containing 80 oz"
          </div>
        </div>
      )}

      {/* Package Summary */}
      {sizeValue && sizeUnit && purchaseUnit && (
        <div className="p-3 bg-background border rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-medium">Package Definition</Label>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div>
              Each {purchaseUnit} contains: <strong>{sizeValue} {sizeUnit}</strong>
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
      {productName.toLowerCase().includes('rice') && sizeValue && sizeUnit === 'oz' && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-md">
          <Label className="text-sm font-medium text-green-800 mb-2 block">
            Recipe Impact Example
          </Label>
          <div className="text-xs text-green-700 space-y-1">
            <div>• 1 cup of rice = 6.3 oz = {((6.3 / sizeValue) * 100).toFixed(1)}% of this package</div>
            <div>• Cost per cup = ${((6.3 / sizeValue) * (form.watch('cost_per_unit') || 0)).toFixed(2)} (if package costs ${(form.watch('cost_per_unit') || 0).toFixed(2)})</div>
            <div>• Package contains ~{(sizeValue / 6.3).toFixed(1)} cups of rice</div>
          </div>
        </div>
      )}
    </div>
  );
}