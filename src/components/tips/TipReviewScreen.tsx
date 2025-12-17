import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrencyFromCents, rebalanceAllocations, type TipShare } from '@/utils/tipPooling';
import { Info } from 'lucide-react';
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
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Today's Tip Split</CardTitle>
        <CardDescription className="space-y-1">
          <div>Total tips: <span className="font-semibold">{formatCurrencyFromCents(totalTipsCents)}</span></div>
          <div>Split by: <span className="font-semibold">{getMethodLabel()}</span></div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Editable Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-muted-foreground border-b">
                <th className="pb-3 font-medium">Employee</th>
                {shareMethod === 'hours' && (
                  <th className="pb-3 font-medium text-right">Hours</th>
                )}
                {shareMethod === 'role' && (
                  <th className="pb-3 font-medium">Role</th>
                )}
                <th className="pb-3 font-medium text-right">Tip</th>
              </tr>
            </thead>
            <tbody>
              {shares.map((share, index) => (
                <tr 
                  key={share.employeeId} 
                  className={`border-b ${index % 2 === 0 ? 'bg-muted/30' : ''}`}
                >
                  <td className="py-3">
                    <div className="font-medium">{share.name}</div>
                  </td>
                  {shareMethod === 'hours' && (
                    <td className="py-3 text-right text-muted-foreground">
                      {share.hours?.toFixed(1) || '—'}
                    </td>
                  )}
                  {shareMethod === 'role' && (
                    <td className="py-3 text-muted-foreground">
                      {share.role || '—'}
                    </td>
                  )}
                  <td className="py-3 text-right">
                    {editingEmployeeId === share.employeeId ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={totalTipsCents / 100}
                        value={(share.amountCents / 100).toFixed(2)}
                        onChange={(e) => {
                          const newAmount = Math.round(parseFloat(e.target.value || '0') * 100);
                          handleAmountChange(share.employeeId, newAmount);
                        }}
                        onBlur={handleAmountBlur}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleAmountBlur();
                          }
                        }}
                        autoFocus
                        className="text-right w-32 ml-auto"
                      />
                    ) : (
                      <button
                        onClick={() => setEditingEmployeeId(share.employeeId)}
                        className="font-semibold hover:text-primary transition-colors text-right w-full"
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
        <div className="flex justify-between items-center p-4 rounded-lg bg-muted/50">
          <span className="font-medium">Total remaining</span>
          <span className={`text-xl font-bold ${remaining === 0 ? 'text-green-600' : 'text-amber-600'}`}>
            {formatCurrencyFromCents(remaining)}
          </span>
        </div>

        {/* Info Alert */}
        {remaining !== 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              Tap any amount to edit. Other amounts will auto-balance to keep the total at{' '}
              {formatCurrencyFromCents(totalTipsCents)}.
            </AlertDescription>
          </Alert>
        )}

        <Separator />

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => onApprove(shares)} 
            disabled={isLoading || shares.length === 0 || totalTipsCents <= 0}
            className="flex-1"
            size="lg"
          >
            {isLoading ? 'Saving...' : 'Approve tips'}
          </Button>
          <Button 
            variant="outline" 
            onClick={() => onSaveDraft(shares)}
            disabled={isLoading}
            className="flex-1"
            size="lg"
          >
            Save as draft
          </Button>
        </div>

        {/* Helper Text */}
        <p className="text-sm text-muted-foreground text-center">
          Approved tips will be recorded and included in payroll.
        </p>
      </CardContent>
    </Card>
  );
}
