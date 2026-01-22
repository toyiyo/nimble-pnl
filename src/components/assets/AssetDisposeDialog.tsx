import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Archive } from 'lucide-react';
import type { Asset, AssetDisposalData } from '@/types/assets';
import { formatAssetCurrency } from '@/types/assets';

interface AssetDisposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
  onDispose: (id: string, data: AssetDisposalData) => void;
  isDisposing: boolean;
}

export function AssetDisposeDialog({
  open,
  onOpenChange,
  asset,
  onDispose,
  isDisposing,
}: AssetDisposeDialogProps) {
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().split('T')[0]);
  const [disposalProceeds, setDisposalProceeds] = useState('');
  const [disposalNotes, setDisposalNotes] = useState('');

  const handleDispose = () => {
    if (!asset) return;

    onDispose(asset.id, {
      disposal_date: disposalDate,
      disposal_proceeds: disposalProceeds ? parseFloat(disposalProceeds) : undefined,
      disposal_notes: disposalNotes || undefined,
    });
  };

  if (!asset) return null;

  const netBookValue = asset.purchase_cost - asset.accumulated_depreciation;
  const proceeds = disposalProceeds ? parseFloat(disposalProceeds) : 0;
  const gainLoss = proceeds - netBookValue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5" />
            Dispose Asset
          </DialogTitle>
          <DialogDescription>
            Mark "{asset.name}" as disposed. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current Value Summary */}
          <div className="rounded-lg bg-muted p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Original Cost</span>
              <span className="font-mono">{formatAssetCurrency(asset.purchase_cost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Accumulated Depreciation</span>
              <span className="font-mono text-amber-600">
                ({formatAssetCurrency(asset.accumulated_depreciation)})
              </span>
            </div>
            <div className="flex justify-between font-medium border-t pt-2">
              <span>Net Book Value</span>
              <span className="font-mono">{formatAssetCurrency(netBookValue)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="disposal-date">Disposal Date</Label>
            <Input
              id="disposal-date"
              type="date"
              value={disposalDate}
              onChange={(e) => setDisposalDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="disposal-proceeds">Sale Proceeds (Optional)</Label>
            <Input
              id="disposal-proceeds"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={disposalProceeds}
              onChange={(e) => setDisposalProceeds(e.target.value)}
            />
            {proceeds > 0 && (
              <p className={`text-sm ${gainLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {gainLoss >= 0 ? 'Gain' : 'Loss'} on disposal:{' '}
                {formatAssetCurrency(Math.abs(gainLoss))}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="disposal-notes">Notes (Optional)</Label>
            <Textarea
              id="disposal-notes"
              placeholder="Reason for disposal, sold to, etc."
              value={disposalNotes}
              onChange={(e) => setDisposalNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDisposing}>
            Cancel
          </Button>
          <Button onClick={handleDispose} disabled={isDisposing || !disposalDate}>
            {isDisposing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Dispose Asset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
