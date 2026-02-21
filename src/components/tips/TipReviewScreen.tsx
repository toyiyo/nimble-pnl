import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrencyFromCents, rebalanceAllocations, type TipShare } from '@/utils/tipPooling';
import { Info, DollarSign } from 'lucide-react';
import type { ShareMethod } from '@/hooks/useTipPoolSettings';

interface TipReviewScreenProps {
  totalTipsCents: number;
  initialShares: TipShare[];
  shareMethod: ShareMethod;
  onApprove: (shares: TipShare[]) => void;
  onSaveDraft: (shares: TipShare[]) => void;
  isLoading?: boolean;
}

/**
 * TipReviewScreen - Part 2 of Apple-style UX
 * 
 * The "most important screen" for building trust.
 * Allows inline editing of tip amounts with automatic rebalancing.
 */
export function TipReviewScreen({
  totalTipsCents,
  initialShares,
  shareMethod,
  onApprove,
  onSaveDraft,
  isLoading = false,
}: TipReviewScreenProps) {
  const [shares, setShares] = useState<TipShare[]>(initialShares);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);

  // Keep local editable state in sync with recalculated shares (e.g., after hours input changes)
  useEffect(() => {
    setShares(initialShares);
  }, [initialShares]);

  const totalAllocated = useMemo(
    () => shares.reduce((sum, s) => sum + s.amountCents, 0),
    [shares]
  );
  const remaining = totalTipsCents - totalAllocated;

  const handleAmountChange = (employeeId: string, newAmountCents: number) => {
    const rebalanced = rebalanceAllocations(
      totalTipsCents,
      shares,
      employeeId,
      newAmountCents
    );
    setShares(rebalanced);
  };

  const handleAmountBlur = () => {
    setEditingEmployeeId(null);
  };

  const getMethodLabel = () => {
    switch (shareMethod) {
      case 'hours':
        return 'Hours worked';
      case 'role':
        return 'By role';
      case 'manual':
        return 'Manual';
      default:
        return 'Custom';
    }
  };

  return (
    <Card className="rounded-xl border-border/40 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 border-b border-border/40">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
            <DollarSign className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h2 className="text-[17px] font-semibold text-foreground">Today's Tip Split</h2>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-[13px] text-muted-foreground">Total: <span className="font-semibold text-foreground">{formatCurrencyFromCents(totalTipsCents)}</span></span>
              <span className="text-[13px] text-muted-foreground">Split by: <span className="font-semibold text-foreground">{getMethodLabel()}</span></span>
            </div>
          </div>
        </div>
      </div>

      <CardContent className="p-6 space-y-5">
        {/* Editable Table */}
        <div className="rounded-xl border border-border/40 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/50 border-b border-border/40">
                <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Employee</th>
                {shareMethod === 'hours' && (
                  <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Hours</th>
                )}
                {shareMethod === 'role' && (
                  <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Role</th>
                )}
                <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Tip</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => (
                <tr
                  key={share.employeeId}
                  className="border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="text-[14px] font-medium text-foreground">{share.name}</span>
                  </td>
                  {shareMethod === 'hours' && (
                    <td className="px-4 py-3 text-right text-[13px] text-muted-foreground">
                      {share.hours?.toFixed(1) || '—'}
                    </td>
                  )}
                  {shareMethod === 'role' && (
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">
                      {share.role || '—'}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    {editingEmployeeId === share.employeeId ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={totalTipsCents / 100}
                        value={(share.amountCents / 100).toFixed(2)}
                        onChange={(e) => {
                          const newAmount = Math.round(Number.parseFloat(e.target.value || '0') * 100);
                          handleAmountChange(share.employeeId, newAmount);
                        }}
                        onBlur={handleAmountBlur}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAmountBlur();
                          }
                        }}
                        autoFocus
                        className="text-right w-32 ml-auto h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                      />
                    ) : (
                      <button
                        onClick={() => setEditingEmployeeId(share.employeeId)}
                        className="text-[14px] font-semibold hover:text-foreground/70 transition-colors text-right w-full"
                        aria-label={`Edit tip amount for ${share.name}`}
                      >
                        {formatCurrencyFromCents(share.amountCents)}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Balance Indicator */}
        <div className="flex justify-between items-center p-4 rounded-xl border border-border/40 bg-muted/30">
          <span className="text-[14px] font-medium text-foreground">Total remaining</span>
          <span className={`text-[22px] font-semibold ${remaining === 0 ? 'text-green-600' : 'text-amber-600'}`}>
            {formatCurrencyFromCents(remaining)}
          </span>
        </div>

        {/* Info Alert */}
        {remaining !== 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription className="text-[13px]">
              Tap any amount to edit. Other amounts will auto-balance to keep the total at{' '}
              {formatCurrencyFromCents(totalTipsCents)}.
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={() => onApprove(shares)}
            disabled={isLoading || shares.length === 0 || totalTipsCents <= 0 || remaining !== 0}
            className="flex-1 h-9 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium"
          >
            {isLoading ? 'Saving...' : 'Approve tips'}
          </Button>
          <Button
            variant="outline"
            onClick={() => onSaveDraft(shares)}
            disabled={isLoading}
            className="flex-1 h-9 rounded-lg text-[13px] font-medium"
          >
            Save as draft
          </Button>
        </div>

        {/* Helper Text */}
        <p className="text-[13px] text-muted-foreground text-center">
          Approved tips will be recorded and included in payroll.
        </p>
      </CardContent>
    </Card>
  );
}
