import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { formatCurrencyFromCents, rebalanceAllocations, type TipShare, type ServerResult, type PoolResult } from '@/utils/tipPooling';
import { Info, DollarSign, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShareMethod, PoolingModel } from '@/hooks/useTipPoolSettings';

interface TipReviewScreenProps {
  readonly totalTipsCents: number;
  readonly initialShares: TipShare[];
  readonly shareMethod: ShareMethod;
  readonly onApprove: (shares: TipShare[]) => void;
  readonly onSaveDraft: (shares: TipShare[]) => void;
  readonly isLoading?: boolean;
  readonly poolingModel?: PoolingModel;
  readonly serverResults?: ServerResult[];
  readonly poolResults?: PoolResult[];
}

/**
 * TipReviewScreen - Part 2 of Apple-style UX
 *
 * The "most important screen" for building trust.
 * Allows inline editing of tip amounts with automatic rebalancing.
 *
 * Supports two modes:
 * - full_pool (default): single table of allocations
 * - percentage_contribution: 3-section layout (server earnings, pool breakdown, all allocations)
 */
export function TipReviewScreen({
  totalTipsCents,
  initialShares,
  shareMethod,
  onApprove,
  onSaveDraft,
  isLoading = false,
  poolingModel,
  serverResults,
  poolResults,
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

  const methodLabels: Record<string, string> = {
    hours: 'Hours worked',
    role: 'By role',
    manual: 'Manual',
  };
  const methodLabel = methodLabels[shareMethod] ?? 'Custom';

  const isPercentageModel = poolingModel === 'percentage_contribution';

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
              <span className="text-[13px] text-muted-foreground">
                {isPercentageModel ? (
                  <>Model: <span className="font-semibold text-foreground">Percentage contribution</span></>
                ) : (
                  <>Split by: <span className="font-semibold text-foreground">{methodLabel}</span></>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      <CardContent className="p-6 space-y-5">
        {/* Percentage Contribution: 3-section layout */}
        {isPercentageModel && serverResults && poolResults ? (
          <>
            {/* Section 1: Server Earnings */}
            <ServerEarningsSection serverResults={serverResults} />

            {/* Section 2: Pool Breakdown */}
            <PoolBreakdownSection poolResults={poolResults} />

            {/* Section 3: All Allocations (existing editable table) */}
            <div className="space-y-2">
              <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wider">
                All Allocations
              </h3>
              <AllocationTable
                shares={shares}
                shareMethod={shareMethod}
                totalTipsCents={totalTipsCents}
                editingEmployeeId={editingEmployeeId}
                onEdit={setEditingEmployeeId}
                onAmountChange={handleAmountChange}
                onBlur={handleAmountBlur}
              />
            </div>
          </>
        ) : (
          /* Full Pool / default: single editable table */
          <AllocationTable
            shares={shares}
            shareMethod={shareMethod}
            totalTipsCents={totalTipsCents}
            editingEmployeeId={editingEmployeeId}
            onEdit={setEditingEmployeeId}
            onAmountChange={handleAmountChange}
            onBlur={handleAmountBlur}
          />
        )}

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

// ── Sub-components ───────────────────────────────────────────────────────────

/**
 * Editable allocation table — shared between both pooling models.
 */
function AllocationTable({
  shares,
  shareMethod,
  totalTipsCents,
  editingEmployeeId,
  onEdit,
  onAmountChange,
  onBlur,
}: Readonly<{
  shares: TipShare[];
  shareMethod: ShareMethod;
  totalTipsCents: number;
  editingEmployeeId: string | null;
  onEdit: (id: string) => void;
  onAmountChange: (employeeId: string, newAmountCents: number) => void;
  onBlur: () => void;
}>) {
  return (
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
                  {share.hours?.toFixed(1) || '\u2014'}
                </td>
              )}
              {shareMethod === 'role' && (
                <td className="px-4 py-3 text-[13px] text-muted-foreground">
                  {share.role || '\u2014'}
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
                      onAmountChange(share.employeeId, newAmount);
                    }}
                    onBlur={onBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onBlur();
                      }
                    }}
                    autoFocus
                    className="text-right w-32 ml-auto h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                ) : (
                  <button
                    onClick={() => onEdit(share.employeeId)}
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
  );
}

/**
 * Section 1: Server Earnings — shows earned, deductions, refunds, and final amounts.
 */
function ServerEarningsSection({ serverResults }: Readonly<{ serverResults: ServerResult[] }>) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wider">
        Server Earnings
      </h3>
      <div className="rounded-xl border border-border/40 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/50 border-b border-border/40">
              <th className="px-4 py-2.5 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Employee</th>
              <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Earned</th>
              <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Deductions</th>
              <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Refunds</th>
              <th className="px-4 py-2.5 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Final</th>
            </tr>
          </thead>
          <tbody>
            {serverResults.map((sr) => {
              // Deductions = total contributed to active pools = earned - retained + refunded
              const deductionsCents = sr.earnedAmountCents - sr.retainedAmountCents + sr.refundedAmountCents;
              return (
                <tr
                  key={sr.employeeId}
                  className="border-b border-border/40 last:border-b-0 hover:bg-muted/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="text-[14px] font-medium text-foreground">{sr.name}</span>
                  </td>
                  <td className="px-4 py-3 text-right text-[14px] text-foreground">
                    {formatCurrencyFromCents(sr.earnedAmountCents)}
                  </td>
                  <td className="px-4 py-3 text-right text-[14px] text-destructive">
                    {deductionsCents > 0 ? `-${formatCurrencyFromCents(deductionsCents)}` : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-right text-[14px] text-green-600">
                    {sr.refundedAmountCents > 0 ? `+${formatCurrencyFromCents(sr.refundedAmountCents)}` : '\u2014'}
                  </td>
                  <td className="px-4 py-3 text-right text-[14px] font-semibold text-foreground">
                    {formatCurrencyFromCents(sr.retainedAmountCents)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Section 2: Pool Breakdown — collapsible per pool, shows distributions.
 */
function PoolBreakdownSection({ poolResults }: Readonly<{ poolResults: PoolResult[] }>) {
  return (
    <div className="space-y-2">
      <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wider">
        Pool Breakdown
      </h3>
      <div className="space-y-2">
        {poolResults.map((pr) => (
          <PoolDisclosure key={pr.poolId} pool={pr} />
        ))}
        {poolResults.length === 0 && (
          <p className="text-[13px] text-muted-foreground py-3">No pools configured.</p>
        )}
      </div>
    </div>
  );
}

/**
 * Collapsible pool detail — shows distribution or refund status.
 */
function PoolDisclosure({ pool }: Readonly<{ pool: PoolResult }>) {
  const [open, setOpen] = useState(pool.totalDistributed > 0);

  const isRefunded = pool.totalDistributed === 0 && pool.totalContributed > 0;

  return (
    <div className="rounded-xl border border-border/40 overflow-hidden">
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/50 hover:bg-muted/70 transition-colors text-left"
        aria-expanded={open}
        aria-label={`Toggle ${pool.poolName} details`}
      >
        <div className="flex items-center gap-2">
          <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <span className="text-[14px] font-medium text-foreground">{pool.poolName}</span>
        </div>
        <span className="text-[13px] text-muted-foreground">
          {isRefunded
            ? `${formatCurrencyFromCents(pool.totalRefunded)} refunded`
            : `${formatCurrencyFromCents(pool.totalDistributed)} distributed`}
        </span>
      </button>

      {open && (
        <div className="px-4 py-3 border-t border-border/40">
          <PoolDisclosureContent pool={pool} isRefunded={isRefunded} />
        </div>
      )}
    </div>
  );
}

function PoolDisclosureContent({ pool, isRefunded }: Readonly<{ pool: PoolResult; isRefunded: boolean }>) {
  if (isRefunded) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
        <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0" />
        <span className="text-[13px] text-amber-600">
          Refunded — no eligible employees worked this day
        </span>
      </div>
    );
  }

  if (pool.recipientShares.length === 0) {
    return <p className="text-[13px] text-muted-foreground">No distributions for this pool.</p>;
  }

  return (
    <table className="w-full">
      <thead>
        <tr className="border-b border-border/40">
          <th className="pb-2 text-left text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Employee</th>
          <th className="pb-2 text-right text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
        </tr>
      </thead>
      <tbody>
        {pool.recipientShares.map((share) => (
          <tr
            key={share.employeeId}
            className="border-b border-border/40 last:border-b-0"
          >
            <td className="py-2 text-[14px] text-foreground">{share.name}</td>
            <td className="py-2 text-right text-[14px] font-medium text-foreground">
              {formatCurrencyFromCents(share.amountCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
