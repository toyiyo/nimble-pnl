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
  const packageQty = form.watch('package_qty') || 1;  // How many packages you're buying
  const productName = form.watch('name') || '';

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
          <strong>📦 How to enter package information correctly:</strong>
        </p>
        <div className="text-xs text-blue-700 space-y-1">
          <div>• <strong>Amount per Package:</strong> How much is in ONE single package? (e.g., 750 for a 750ml bottle)</div>
          <div>• <strong>Unit:</strong> What unit is that amount measured in? (e.g., ml, oz, lb)</div>
          <div>• <strong>Package Type:</strong> What type of container? (e.g., bottle, bag, case)</div>
          <div>• <strong>Quantity:</strong> How many of those packages are you buying? (usually 1)</div>
        </div>
        <div className="text-xs text-blue-600 mt-2 p-2 bg-blue-100 rounded border-l-2 border-blue-400">
          <strong>✅ Correct Example:</strong> "1 bottle containing 750 ml"<br/>
          Amount: <code>750</code>, Unit: <code>ml</code>, Type: <code>bottle</code>, Quantity: <code>1</code>
        </div>
        <div className="text-xs text-red-600 mt-1 p-2 bg-red-50 rounded border-l-2 border-red-400">
          <strong>❌ Common Mistake:</strong> Don't enter 750 in the quantity field - that means 750 bottles!
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <FormField
          control={form.control}
          name="size_value"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <span className="text-base font-medium">Amount per Package</span>
                <span className="text-xs text-muted-foreground font-normal">📦</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  step="0.01"
                  placeholder="750"
                  className="text-center text-lg font-mono"
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : undefined)}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">How much is in one single package</p>
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
                <span className="text-base font-medium">Unit</span>
                <span className="text-xs text-muted-foreground font-normal">📏</span>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="text-center">
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="ml">ml (milliliters)</SelectItem>
                  <SelectItem value="L">L (liters)</SelectItem>
                  <SelectItem value="oz">oz (ounces)</SelectItem>
                  <SelectItem value="lb">lb (pounds)</SelectItem>
                  <SelectItem value="g">g (grams)</SelectItem>
                  <SelectItem value="kg">kg (kilograms)</SelectItem>
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
                <span className="text-base font-medium">Package Type</span>
                <span className="text-xs text-muted-foreground font-normal">📦</span>
              </FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="text-center">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="bottle">bottle</SelectItem>
                  <SelectItem value="bag">bag</SelectItem>
                  <SelectItem value="case">case</SelectItem>
                  <SelectItem value="box">box</SelectItem>
                  <SelectItem value="can">can</SelectItem>
                  <SelectItem value="jar">jar</SelectItem>
                  <SelectItem value="pack">pack</SelectItem>
                  <SelectItem value="container">container</SelectItem>
                  <SelectItem value="unit">unit</SelectItem>
                  <SelectItem value="each">each</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Type of container/package</p>
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
                <span className="text-base font-medium">Quantity</span>
                <span className="text-xs text-muted-foreground font-normal">🔢</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="number"
                  min="1"
                  step="1"
                  placeholder="1"
                  className="text-center text-lg font-mono"
                  onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : 1)}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">How many packages you're buying</p>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      
      {/* Live example */}
      {sizeValue && sizeUnit && purchaseUnit && (
        <div className="p-4 bg-green-50 border-2 border-green-300 rounded-md">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center">
              <span className="text-white text-sm font-bold">✓</span>
            </div>
            <Label className="text-base font-semibold text-green-800">Your Package Definition:</Label>
          </div>
          <div className="text-lg font-medium text-green-800 mb-2">
            <span className="bg-green-200 px-2 py-1 rounded">{packageQty}</span> {purchaseUnit}{packageQty !== 1 ? 's' : ''}, 
            each containing <span className="bg-green-200 px-2 py-1 rounded">{sizeValue} {sizeUnit}</span>
          </div>
          <div className="text-sm text-green-700 bg-green-100 p-2 rounded">
            <strong>Total you're buying:</strong> {(sizeValue * packageQty).toLocaleString()} {sizeUnit} 
            ({packageQty} × {sizeValue} {sizeUnit})
          </div>
        </div>
      )}

      {/* Alternative unit conversions */}
      {sizeValue && sizeUnit && purchaseUnit && alternativeUnits.length > 0 && (
        <div className="p-3 bg-background border rounded-md">
          <div className="flex items-center gap-2 mb-2">
            <Label className="text-sm font-medium">💡 Alternative Measurements</Label>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <div className="mb-2">
              Each {purchaseUnit} ({sizeValue} {sizeUnit}) also equals:
            </div>
            <div className="flex flex-wrap gap-2">
              {alternativeUnits.map((alt, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {alt.value.toFixed(alt.value < 1 ? 3 : 2)} {alt.unit}
                </Badge>
              ))}
            </div>
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