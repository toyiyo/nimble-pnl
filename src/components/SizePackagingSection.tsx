import React, { useMemo } from 'react';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Package, Scale } from 'lucide-react';
import { GroupedUnitSelector } from '@/components/GroupedUnitSelector';
import { convertUnits, WEIGHT_UNITS, VOLUME_UNITS } from '@/lib/enhancedUnitConversion';

interface SizePackagingSectionProps {
  form: any;
}

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

  // Calculate alternative units  
  const alternativeUnits = useMemo(() => {
    if (!sizeValue || !sizeUnit) return [];

    const alternatives: { unit: string; value: number }[] = [];
    const totalValue = sizeValue;

    // Weight conversions
    if (sizeUnit === 'oz') {
      if (totalValue >= 16) {
        const converted = convertUnits(totalValue, 'oz', 'lb');
        if (converted) alternatives.push({ unit: 'lb', value: converted.value });
      }
      const grams = convertUnits(totalValue, 'oz', 'g');
      if (grams) alternatives.push({ unit: 'g', value: grams.value });
      const kg = convertUnits(totalValue, 'oz', 'kg');
      if (kg && kg.value >= 1) {
        alternatives.push({ unit: 'kg', value: kg.value });
      }
    }
    else if (sizeUnit === 'lb') {
      const oz = convertUnits(totalValue, 'lb', 'oz');
      if (oz) alternatives.push({ unit: 'oz', value: oz.value });
      const grams = convertUnits(totalValue, 'lb', 'g');
      if (grams) alternatives.push({ unit: 'g', value: grams.value });
      const kg = convertUnits(totalValue, 'lb', 'kg');
      if (kg) alternatives.push({ unit: 'kg', value: kg.value });
    }
    else if (sizeUnit === 'kg') {
      const lb = convertUnits(totalValue, 'kg', 'lb');
      if (lb) alternatives.push({ unit: 'lb', value: lb.value });
      const oz = convertUnits(totalValue, 'kg', 'oz');
      if (oz) alternatives.push({ unit: 'oz', value: oz.value });
      const grams = convertUnits(totalValue, 'kg', 'g');
      if (grams) alternatives.push({ unit: 'g', value: grams.value });
    }
    else if (sizeUnit === 'g') {
      if (totalValue >= 1000) {
        const kg = convertUnits(totalValue, 'g', 'kg');
        if (kg) alternatives.push({ unit: 'kg', value: kg.value });
      }
      const oz = convertUnits(totalValue, 'g', 'oz');
      if (oz) alternatives.push({ unit: 'oz', value: oz.value });
      const lb = convertUnits(totalValue, 'g', 'lb');
      if (lb && lb.value >= 1) {
        alternatives.push({ unit: 'lb', value: lb.value });
      }
    }
    // Volume conversions
    else if (sizeUnit === 'fl oz') {
      const ml = convertUnits(totalValue, 'fl oz', 'ml');
      if (ml) alternatives.push({ unit: 'ml', value: ml.value });
      if (totalValue >= 8) {
        const cups = convertUnits(totalValue, 'fl oz', 'cup');
        if (cups) alternatives.push({ unit: 'cup', value: cups.value });
      }
      const liters = convertUnits(totalValue, 'fl oz', 'L');
      if (liters && liters.value >= 1) {
        alternatives.push({ unit: 'L', value: liters.value });
      }
      if (totalValue >= 128) {
        const gal = convertUnits(totalValue, 'fl oz', 'gal');
        if (gal) alternatives.push({ unit: 'gal', value: gal.value });
      }
    }
    else if (sizeUnit === 'ml') {
      const floz = convertUnits(totalValue, 'ml', 'fl oz');
      if (floz) alternatives.push({ unit: 'fl oz', value: floz.value });
      if (totalValue >= 1000) {
        const liters = convertUnits(totalValue, 'ml', 'L');
        if (liters) alternatives.push({ unit: 'L', value: liters.value });
      }
      if (totalValue >= 236.588) {
        const cups = convertUnits(totalValue, 'ml', 'cup');
        if (cups) alternatives.push({ unit: 'cup', value: cups.value });
      }
    }
    else if (sizeUnit === 'L') {
      const ml = convertUnits(totalValue, 'L', 'ml');
      if (ml) alternatives.push({ unit: 'ml', value: ml.value });
      const floz = convertUnits(totalValue, 'L', 'fl oz');
      if (floz) alternatives.push({ unit: 'fl oz', value: floz.value });
      const cups = convertUnits(totalValue, 'L', 'cup');
      if (cups) alternatives.push({ unit: 'cup', value: cups.value });
      const gal = convertUnits(totalValue, 'L', 'gal');
      if (gal) alternatives.push({ unit: 'gal', value: gal.value });
    }
    else if (sizeUnit === 'gal') {
      const liters = convertUnits(totalValue, 'gal', 'L');
      if (liters) alternatives.push({ unit: 'L', value: liters.value });
      const floz = convertUnits(totalValue, 'gal', 'fl oz');
      if (floz) alternatives.push({ unit: 'fl oz', value: floz.value });
      const qt = convertUnits(totalValue, 'gal', 'qt');
      if (qt) alternatives.push({ unit: 'qt', value: qt.value });
    }
    else if (sizeUnit === 'cup') {
      const ml = convertUnits(totalValue, 'cup', 'ml');
      if (ml) alternatives.push({ unit: 'ml', value: ml.value });
      const floz = convertUnits(totalValue, 'cup', 'fl oz');
      if (floz) alternatives.push({ unit: 'fl oz', value: floz.value });
      const tbsp = convertUnits(totalValue, 'cup', 'tbsp');
      if (tbsp) alternatives.push({ unit: 'tbsp', value: tbsp.value });
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
        </div>
        <div className="text-xs text-blue-600 mt-2 p-2 bg-blue-100 rounded border-l-2 border-blue-400">
          <strong>✅ Correct Example:</strong> "1 bottle containing 750 ml"<br/>
          Amount: <code>750</code>, Unit: <code>ml</code>, Type: <code>bottle</code>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                  value={field.value !== undefined && field.value !== null ? String(field.value) : ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === '') {
                      field.onChange(undefined);
                    } else {
                      const parsed = parseFloat(value);
                      field.onChange(isNaN(parsed) ? undefined : parsed);
                    }
                  }}
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
              <FormControl>
                <GroupedUnitSelector
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                  placeholder="Select unit"
                  className="text-center"
                />
              </FormControl>
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
              <Select onValueChange={field.onChange} value={field.value || ''}>
                <FormControl>
                  <SelectTrigger className="text-center">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {/* Primary Packaging */}
                  <SelectItem value="bag">Bag</SelectItem>
                  <SelectItem value="box">Box</SelectItem>
                  <SelectItem value="bottle">Bottle</SelectItem>
                  <SelectItem value="can">Can</SelectItem>
                  <SelectItem value="jar">Jar</SelectItem>
                  <SelectItem value="tube">Tube</SelectItem>
                  <SelectItem value="sachet">Sachet</SelectItem>
                  <SelectItem value="packet">Packet</SelectItem>
                  <SelectItem value="pouch">Pouch</SelectItem>
                  <SelectItem value="tray">Tray</SelectItem>
                  <SelectItem value="cup">Cup</SelectItem>
                  <SelectItem value="bowl">Bowl</SelectItem>
                  <SelectItem value="carton">Carton</SelectItem>
                  <SelectItem value="roll">Roll</SelectItem>
                  <SelectItem value="bar">Bar</SelectItem>
                  <SelectItem value="piece">Piece</SelectItem>
                  <SelectItem value="slice">Slice</SelectItem>
                  <SelectItem value="loaf">Loaf</SelectItem>
                  <SelectItem value="portion">Portion</SelectItem>
                  
                  {/* Secondary/Bulk */}
                  <SelectItem value="case">Case</SelectItem>
                  <SelectItem value="crate">Crate</SelectItem>
                  <SelectItem value="pack">Pack</SelectItem>
                  <SelectItem value="multipack">Multipack</SelectItem>
                  <SelectItem value="bundle">Bundle</SelectItem>
                  <SelectItem value="drum">Drum</SelectItem>
                  <SelectItem value="barrel">Barrel</SelectItem>
                  <SelectItem value="bucket">Bucket</SelectItem>
                  <SelectItem value="tub">Tub</SelectItem>
                  <SelectItem value="jug">Jug</SelectItem>
                  
                  {/* Count/Generic */}
                  <SelectItem value="unit">Unit</SelectItem>
                  <SelectItem value="each">Each</SelectItem>
                  <SelectItem value="container">Container</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Type of container/package</p>
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
          <div className="text-lg font-medium text-green-800">
            1 {purchaseUnit} containing <span className="bg-green-200 px-2 py-1 rounded">{sizeValue} {sizeUnit}</span>
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