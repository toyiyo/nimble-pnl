import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { convertDisplayToPurchase, convertPurchaseToDisplay } from '@/lib/inventoryDisplay';

interface InventoryLevelInputProps {
  label: string;
  value: number; // Value in purchase units
  onChange: (purchaseValue: number) => void;
  product: {
    uom_purchase?: string | null;
    size_value?: number | null;
    size_unit?: string | null;
    name?: string;
  };
  helpText?: string;
  placeholder?: string;
}

export function InventoryLevelInput({ 
  label, 
  value, 
  onChange, 
  product, 
  helpText,
  placeholder 
}: InventoryLevelInputProps) {
  const hasConversion = !!product.size_value && !!product.size_unit;
  const [displayValue, setDisplayValue] = useState('');
  
  // Initialize display value (already in package units)
  useEffect(() => {
    setDisplayValue(value.toFixed(2));
  }, [value]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;
    setDisplayValue(inputVal);
    
    const numVal = parseFloat(inputVal);
    if (!isNaN(numVal)) {
      onChange(numVal); // Already in purchase units (packages)
    }
  };
  
  const displayUnit = product.uom_purchase || 'units'; // Always show package type
  const packageCount = value; // Value is already in purchase units (packages)
  
  // When there's size info, calculate total weight/volume for reference
  const totalMeasurement = hasConversion && product.size_value
    ? {
        value: packageCount * product.size_value,
        unit: product.size_unit
      }
    : null;
  
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        {hasConversion && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-sm">Enter quantity in {displayUnit}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  1 {product.uom_purchase} = {product.size_value} {product.size_unit}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      
      <div className="space-y-2">
        <div className="relative">
          <Input
            type="number"
            step="0.01"
            value={displayValue}
            onChange={handleInputChange}
            placeholder={placeholder || `Enter ${displayUnit}`}
            className="pr-16"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Badge variant="secondary" className="text-xs">
              {displayUnit}
            </Badge>
          </div>
        </div>
        
        {hasConversion && totalMeasurement && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>=</span>
            <Badge variant="outline" className="font-mono">
              {totalMeasurement.value.toFixed(2)} {totalMeasurement.unit} total
            </Badge>
            <span className="text-xs">
              ({product.size_value} {product.size_unit} per {product.uom_purchase})
            </span>
          </div>
        )}
      </div>
      
      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}
