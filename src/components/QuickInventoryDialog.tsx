import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Package, Check, Plus, Minus, X, Divide } from 'lucide-react';
import { Product } from '@/hooks/useProducts';
import { LocationCombobox } from '@/components/LocationCombobox';
import { evaluateExpression, formatCalculatorResult } from '@/utils/calculator';

interface QuickInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  mode: 'add' | 'reconcile';
  onSave: (quantity: number, location?: string) => Promise<void>;
  currentTotal?: number;
  restaurantId: string | null;
}

export const QuickInventoryDialog: React.FC<QuickInventoryDialogProps> = ({
  open,
  onOpenChange,
  product,
  mode,
  onSave,
  currentTotal,
  restaurantId
}) => {
  const [quantity, setQuantity] = useState<string>('');
  const [location, setLocation] = useState<string>('');
  const [saving, setSaving] = useState(false);

  // Calculate the result of the expression
  const calculatedValue = useMemo(() => {
    if (!quantity) return null;
    return evaluateExpression(quantity);
  }, [quantity]);

  // Check if the current input is a valid expression
  const isValidExpression = calculatedValue !== null && calculatedValue > 0;

  const quickButtons = [6, 10, 20, 24];
  const numpadButtons = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const operatorButtons = [
    { label: '+', value: '+', icon: Plus, ariaLabel: 'Add' },
    { label: '-', value: '-', icon: Minus, ariaLabel: 'Subtract' },
    { label: '×', value: '*', icon: X, ariaLabel: 'Multiply' },
    { label: '÷', value: '/', icon: Divide, ariaLabel: 'Divide' },
  ];

  const handleQuickSelect = (value: number) => {
    setQuantity(value.toString());
  };

  const handleNumpadClick = (value: string) => {
    setQuantity(prev => prev + value);
  };

  const handleClear = () => {
    setQuantity('');
  };

  const handleBackspace = () => {
    setQuantity(prev => prev.slice(0, -1));
  };

  const handleSave = async () => {
    if (!isValidExpression || !calculatedValue) return;
    
    setSaving(true);
    try {
      await onSave(calculatedValue, location || undefined);
      setQuantity('');
      setLocation('');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const displayValue = quantity || '0';
  const displayResult = calculatedValue !== null ? formatCalculatorResult(calculatedValue) : displayValue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <Package className="h-5 w-5 text-foreground" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Quick Inventory</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground mt-0.5">
                {[product.brand, product.uom_purchase]
                  .filter(Boolean)
                  .join(' · ') || 'Enter quantity'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4">
          {/* Product Info */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[14px] font-medium text-foreground leading-tight break-words">
                  {product.name}
                </h3>
                <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground shrink-0">
                  {mode === 'add' ? 'Add' : 'Reconcile'}
                </span>
              </div>
              {product.brand && (
                <p className="text-[13px] text-muted-foreground mt-0.5">{product.brand}</p>
              )}
            </div>
            {product.current_stock !== null && product.current_stock !== undefined && (
              <div className="px-4 py-2.5 text-[13px]">
                <span className="text-muted-foreground">Current: </span>
                <span className="font-medium text-foreground">{product.current_stock} {product.uom_purchase || 'units'}</span>
              </div>
            )}
          </div>

          {/* Current Total (if adding finds) */}
          {mode === 'add' && currentTotal !== undefined && (
            <div className="rounded-lg border border-border/40 bg-muted/30 px-4 py-2.5 text-[13px]">
              <span className="text-muted-foreground">Current Total: </span>
              <span className="font-medium text-foreground">{currentTotal} {product.uom_purchase || 'units'}</span>
            </div>
          )}

          {/* Quantity Display */}
          <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
            <div className="text-center">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {mode === 'add' ? 'Quantity to Add' : 'Total Quantity'}
              </div>
              {quantity && quantity !== displayResult ? (
                <>
                  <div className="text-[15px] text-muted-foreground font-mono mb-1">
                    {displayValue}
                  </div>
                  <div className="text-[40px] font-semibold text-foreground leading-none">
                    = {displayResult}
                  </div>
                </>
              ) : (
                <div className="text-[40px] font-semibold text-foreground leading-none">
                  {displayValue}
                </div>
              )}
              {mode === 'add' && currentTotal !== undefined && calculatedValue !== null && (
                <div className="text-[13px] text-muted-foreground mt-2">
                  New total: <span className="font-medium text-foreground">
                    {formatCalculatorResult(currentTotal + calculatedValue)}
                  </span> {product.uom_purchase || 'units'}
                </div>
              )}
            </div>
          </div>

          {/* Location Input */}
          <div className="space-y-1.5">
            <Label htmlFor="location" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Location (optional)
            </Label>
            <LocationCombobox
              restaurantId={restaurantId}
              value={location}
              onValueChange={setLocation}
              placeholder="e.g., Bar, Fridge, Storage"
            />
          </div>

          {/* Quick Buttons */}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-foreground">Quick Select</div>
            <div className="grid grid-cols-4 gap-2">
              {quickButtons.map((num) => (
                <Button
                  key={num}
                  variant="outline"
                  onClick={() => handleQuickSelect(num)}
                  className="h-14 rounded-lg text-[15px] font-semibold border-border/40 bg-muted/30 hover:bg-muted/60 text-foreground transition-colors"
                >
                  {num}
                </Button>
              ))}
            </div>
          </div>

          {/* Number Pad */}
          <div className="space-y-2">
            <div className="text-[13px] font-semibold text-foreground">Custom Amount</div>
            <div className="grid grid-cols-4 gap-2">
              {/* Numpad digits - 3 columns */}
              <div className="col-span-3 grid grid-cols-3 gap-2">
                {numpadButtons.map((digit) => (
                  <Button
                    key={digit}
                    variant="ghost"
                    onClick={() => handleNumpadClick(digit.toString())}
                    className="h-16 rounded-lg text-[17px] font-semibold bg-muted/30 hover:bg-muted/60 text-foreground border border-border/40 transition-colors"
                  >
                    {digit}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  onClick={() => handleNumpadClick('.')}
                  className="h-16 rounded-lg text-[17px] font-semibold bg-muted/30 hover:bg-muted/60 text-foreground border border-border/40 transition-colors"
                >
                  .
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleNumpadClick('0')}
                  className="h-16 rounded-lg text-[17px] font-semibold bg-muted/30 hover:bg-muted/60 text-foreground border border-border/40 transition-colors"
                >
                  0
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleBackspace}
                  aria-label="Backspace"
                  className="h-16 rounded-lg text-[15px] bg-muted/30 hover:bg-muted/60 text-foreground border border-border/40 transition-colors"
                >
                  ⌫
                </Button>
              </div>

              {/* Operator buttons - 1 column */}
              <div className="col-span-1 grid grid-cols-1 gap-2">
                {operatorButtons.map((op) => (
                  <Button
                    key={op.value}
                    variant="ghost"
                    onClick={() => handleNumpadClick(op.value)}
                    className="h-16 rounded-lg bg-muted/50 hover:bg-muted text-foreground border border-border/40 transition-colors"
                    aria-label={op.ariaLabel}
                  >
                    <op.icon className="h-4 w-4" />
                  </Button>
                ))}
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={handleClear}
              className="h-10 w-full rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground border border-border/40 bg-muted/30 hover:bg-muted/60 transition-colors"
            >
              Clear
            </Button>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-9 px-4 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!isValidExpression || saving}
              className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
            >
              <Check className="h-4 w-4 mr-1.5" aria-hidden="true" />
              {saving ? 'Saving...' : mode === 'add' ? `Add ${displayResult}` : `Set to ${displayResult}`}
            </Button>
          </div>

          {mode === 'reconcile' && (
            <p className="text-[12px] text-center text-muted-foreground">
              This will set the total inventory to {displayResult} {product.uom_purchase || 'units'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
