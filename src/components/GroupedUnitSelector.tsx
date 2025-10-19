import React from 'react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { getUnitOptions, VALID_UNITS } from '@/lib/validUnits';
import { PRODUCT_CONVERSIONS, WEIGHT_UNITS, VOLUME_UNITS, COUNT_UNITS, convertUnits } from '@/lib/enhancedUnitConversion';
import { cn } from '@/lib/utils';

interface GroupedUnitSelectorProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  productName?: string;
  productSizeUnit?: string;
  className?: string;
}

export function GroupedUnitSelector({ 
  value, 
  onValueChange, 
  placeholder = "Select unit",
  productName,
  productSizeUnit,
  className 
}: GroupedUnitSelectorProps) {
  
  // Determine which units have conversion factors for this product
  const getConversionStatus = (unit: string): { hasConversion: boolean; label?: string } => {
    // Check product-specific conversions first
    if (productName) {
      const normalizedName = productName.toLowerCase();
      
      for (const [productType, conversions] of Object.entries(PRODUCT_CONVERSIONS)) {
        if (normalizedName.includes(productType.replace('_', ' '))) {
          const hasFromConversion = Object.keys(conversions).some(key => 
            key.startsWith(`${unit}_to_`) || key.endsWith(`_to_${unit}`)
          );
          
          if (hasFromConversion) {
            return { hasConversion: true, label: '✓' };
          }
        }
      }
    }
    
    // Check standard conversions between same unit categories
    if (productSizeUnit) {
      const sizeUnit = productSizeUnit.toLowerCase();
      const recipeUnit = unit.toLowerCase();
      
      // Check if both units are in the same category
      const bothWeight = WEIGHT_UNITS.includes(sizeUnit) && WEIGHT_UNITS.includes(recipeUnit);
      const bothVolume = VOLUME_UNITS.includes(sizeUnit) && VOLUME_UNITS.includes(recipeUnit);
      const bothCount = COUNT_UNITS.includes(sizeUnit) && COUNT_UNITS.includes(recipeUnit);
      
      if (bothWeight || bothVolume || bothCount) {
        // Try conversion to verify it's actually possible
        const testConversion = convertUnits(1, recipeUnit, sizeUnit, productName);
        if (testConversion) {
          return { hasConversion: true, label: '✓' };
        }
      }
    }
    
    return { hasConversion: false };
  };

  const unitOptions = getUnitOptions();

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[300px]">
        {unitOptions.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel className="text-xs font-semibold text-muted-foreground px-2 py-1.5">
              {group.label}
            </SelectLabel>
            {group.options.map((option) => {
              const status = getConversionStatus(option.value);
              return (
                <SelectItem 
                  key={option.value} 
                  value={option.value}
                  className={cn(
                    "pl-6",
                    status.hasConversion && "bg-green-50/50 dark:bg-green-950/20"
                  )}
                >
                  <div className="flex items-center justify-between w-full gap-2">
                    <span>{option.label}</span>
                    {status.hasConversion && (
                      <Badge 
                        variant="outline" 
                        className="text-[10px] h-4 px-1 bg-green-100 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-400 dark:border-green-800"
                      >
                        conversion
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
