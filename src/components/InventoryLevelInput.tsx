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
  
  // Initialize display value from purchase value
  useEffect(() => {
    if (hasConversion) {
      const converted = convertPurchaseToDisplay(value, product);
      if (converted) {
        setDisplayValue(converted.value.toFixed(2));
      }
    } else {
      setDisplayValue(value.toFixed(2));
    }
  }, [value, product, hasConversion]);
  
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = e.target.value;
    setDisplayValue(inputVal);
    
    const numVal = parseFloat(inputVal);
    if (!isNaN(numVal)) {
      if (hasConversion) {
        // Convert display to purchase units
        const purchaseVal = convertDisplayToPurchase(numVal, product);
        onChange(purchaseVal);
      } else {
        onChange(numVal);
      }
    }
  };
  
  const displayUnit = hasConversion ? product.size_unit : product.uom_purchase || 'units';
  const purchaseEquivalent = hasConversion && displayValue 
    ? convertDisplayToPurchase(parseFloat(displayValue) || 0, product)
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
                <p className="text-sm">Enter amount in {displayUnit}</p>
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
        
        {hasConversion && purchaseEquivalent !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>=</span>
            <Badge variant="outline" className="font-mono">
              {purchaseEquivalent.toFixed(3)} {product.uom_purchase}
            </Badge>
            <span className="text-xs">
              ({((purchaseEquivalent % 1) * 100).toFixed(1)}% of a {product.uom_purchase})
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
