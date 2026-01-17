import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { Product } from '@/hooks/useProducts';

interface QuickProductFixDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly product: Product | null;
  readonly onSave: (productId: string, updates: Partial<Product>) => Promise<boolean> | void;
}

export function QuickProductFixDialog({ open, onOpenChange, product, onSave }: QuickProductFixDialogProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costPerUnit, setCostPerUnit] = useState<string>('');
  const [uomPurchase, setUomPurchase] = useState<string>('');
  const [sizeValue, setSizeValue] = useState<string>('');
  const [sizeUnit, setSizeUnit] = useState<string>('');

  useEffect(() => {
    if (!product) {
      setCostPerUnit('');
      setUomPurchase('');
      setSizeValue('');
      setSizeUnit('');
      setError(null);
      return;
    }

    setCostPerUnit(product.cost_per_unit?.toString() || '');
    setUomPurchase(product.uom_purchase || '');
    setSizeValue(product.size_value?.toString() || '');
    setSizeUnit(product.size_unit || '');
    setError(null);
  }, [product, open]);

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    setError(null);

    try {
      const result = await onSave(product.id, {
        cost_per_unit: costPerUnit ? Number(costPerUnit) : null,
        uom_purchase: uomPurchase || null,
        size_value: sizeValue ? Number(sizeValue) : null,
        size_unit: sizeUnit || null,
      });

      if (result === false) {
        setError('Could not save changes.');
        return;
      }

      onOpenChange(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Fix: {product?.name || 'Product'}</DialogTitle>
          <DialogDescription>Update cost and size details so prep pricing is accurate.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="quick-cost">Unit Cost</Label>
            <Input
              id="quick-cost"
              type="number"
              step="0.01"
              value={costPerUnit}
              onChange={(e) => setCostPerUnit(e.target.value)}
              placeholder="6.50"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="quick-uom">Purchase Unit</Label>
            <Input
              id="quick-uom"
              value={uomPurchase}
              onChange={(e) => setUomPurchase(e.target.value)}
              placeholder="lb, bag, jar"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="quick-size-value">Size Value</Label>
              <Input
                id="quick-size-value"
                type="number"
                step="0.01"
                value={sizeValue}
                onChange={(e) => setSizeValue(e.target.value)}
                placeholder="16"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="quick-size-unit">Size Unit</Label>
              <Input
                id="quick-size-unit"
                value={sizeUnit}
                onChange={(e) => setSizeUnit(e.target.value)}
                placeholder="oz"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Example: 16 oz per bag or 1 lb per bag.</p>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !product}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
