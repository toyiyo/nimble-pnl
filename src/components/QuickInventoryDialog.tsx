import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Package, Check } from 'lucide-react';
import { Product } from '@/hooks/useProducts';

interface QuickInventoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
  mode: 'add' | 'reconcile';
  onSave: (quantity: number) => Promise<void>;
}

export const QuickInventoryDialog: React.FC<QuickInventoryDialogProps> = ({
  open,
  onOpenChange,
  product,
  mode,
  onSave
}) => {
  const [quantity, setQuantity] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const quickButtons = [6, 10, 20, 24];
  const numpadButtons = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

  const handleQuickSelect = (value: number) => {
    setQuantity(value.toString());
  };

  const handleNumpadClick = (digit: number) => {
    setQuantity(prev => prev + digit.toString());
  };

  const handleClear = () => {
    setQuantity('');
  };

  const handleBackspace = () => {
    setQuantity(prev => prev.slice(0, -1));
  };

  const handleSave = async () => {
    if (!quantity || parseInt(quantity) <= 0) return;
    
    setSaving(true);
    try {
      await onSave(parseInt(quantity));
      setQuantity('');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const displayValue = quantity || '0';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Quick Inventory
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Product Info */}
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-lg leading-tight break-words">
                  {product.name}
                </h3>
                {product.brand && (
                  <p className="text-sm text-muted-foreground">{product.brand}</p>
                )}
              </div>
              <Badge variant={mode === 'add' ? 'default' : 'secondary'}>
                {mode === 'add' ? 'Add' : 'Reconcile'}
              </Badge>
            </div>
            {product.current_stock !== null && product.current_stock !== undefined && (
              <div className="text-sm">
                <span className="text-muted-foreground">Current: </span>
                <span className="font-medium">{product.current_stock} {product.uom_purchase || 'units'}</span>
              </div>
            )}
          </div>

          {/* Quantity Display */}
          <div className="bg-primary/5 border-2 border-primary/20 rounded-lg p-4">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">
                {mode === 'add' ? 'Quantity to Add' : 'Total Quantity'}
              </div>
              <div className="text-4xl font-bold text-primary">
                {displayValue}
              </div>
            </div>
          </div>

          {/* Quick Buttons */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Quick Select</div>
            <div className="grid grid-cols-4 gap-2">
              {quickButtons.map((num) => (
                <Button
                  key={num}
                  variant="outline"
                  size="lg"
                  onClick={() => handleQuickSelect(num)}
                  className="text-lg font-semibold h-14"
                >
                  {num}
                </Button>
              ))}
            </div>
          </div>

          {/* Number Pad */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Custom Amount</div>
            <div className="grid grid-cols-3 gap-2">
              {numpadButtons.map((digit) => (
                <Button
                  key={digit}
                  variant="secondary"
                  size="lg"
                  onClick={() => handleNumpadClick(digit)}
                  className="text-xl font-semibold h-16"
                >
                  {digit}
                </Button>
              ))}
              <Button
                variant="secondary"
                size="lg"
                onClick={handleClear}
                className="text-base h-16"
              >
                Clear
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={handleBackspace}
                className="text-base h-16"
              >
                ⌫
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              className="h-14"
            >
              Cancel
            </Button>
            <Button
              size="lg"
              onClick={handleSave}
              disabled={!quantity || parseInt(quantity) <= 0 || saving}
              className="h-14 text-lg font-semibold"
            >
              <Check className="h-5 w-5 mr-2" />
              {mode === 'add' ? 'Add' : 'Set'} {displayValue}
            </Button>
          </div>

          {mode === 'reconcile' && (
            <p className="text-xs text-center text-muted-foreground">
              This will set the total inventory to {displayValue} {product.uom_purchase || 'units'}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
