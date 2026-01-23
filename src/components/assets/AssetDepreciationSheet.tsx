import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Loader2,
  Calculator,
  AlertCircle,
  CheckCircle2,
  FileText,
  Calendar,
} from 'lucide-react';
import { useAssetDepreciation } from '@/hooks/useAssetDepreciation';
import type { Asset, DepreciationCalculation } from '@/types/assets';
import { formatAssetCurrency } from '@/types/assets';

interface AssetDepreciationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatPeriod(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);

  // If same month, just show "Jan 2024"
  if (startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear()) {
    return startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  return `${startDate.toLocaleDateString('en-US', { month: 'short' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

export function AssetDepreciationSheet({
  open,
  onOpenChange,
  asset,
}: AssetDepreciationSheetProps) {
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [preview, setPreview] = useState<DepreciationCalculation | null>(null);
  const [hasCalculated, setHasCalculated] = useState(false);

  const {
    history,
    isLoadingHistory,
    calculateDepreciation,
    isCalculating,
    postDepreciation,
    isPosting,
    getSuggestedNextPeriod,
    lastDepreciationDate,
  } = useAssetDepreciation({ assetId: asset?.id || null });

  // Set suggested period when asset changes
  useEffect(() => {
    if (asset && open) {
      const suggested = getSuggestedNextPeriod();
      if (suggested) {
        setPeriodStart(suggested.start);
        setPeriodEnd(suggested.end);
      }
      setPreview(null);
      setHasCalculated(false);
    }
  }, [asset?.id, open]);

  const handleCalculate = async () => {
    if (!asset || !periodStart || !periodEnd) return;

    try {
      const result = await calculateDepreciation({
        assetId: asset.id,
        periodStart,
        periodEnd,
      });
      setPreview(result);
      setHasCalculated(true);
    } catch (error) {
      setPreview(null);
      setHasCalculated(false);
    }
  };

  const handlePost = async () => {
    if (!asset || !periodStart || !periodEnd) return;

    try {
      await postDepreciation({
        assetId: asset.id,
        periodStart,
        periodEnd,
      });
      setPreview(null);
      setHasCalculated(false);
      // Refresh suggested period
      const suggested = getSuggestedNextPeriod();
      if (suggested) {
        setPeriodStart(suggested.start);
        setPeriodEnd(suggested.end);
      }
    } catch {
      // Error handled in hook
    }
  };

  if (!asset) return null;

  const isFullyDepreciated = asset.status === 'fully_depreciated';
  const isDisposed = asset.status === 'disposed';
  const canDepreciate = !isFullyDepreciated && !isDisposed;
  const hasRequiredAccounts =
    asset.depreciation_expense_account_id &&
    asset.accumulated_depreciation_account_id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Depreciation
          </SheetTitle>
          <SheetDescription>
            Run depreciation for {asset.name}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Asset Summary */}
          <div className="rounded-lg bg-muted p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Purchase Cost</span>
              <span className="font-mono font-medium">
                {formatAssetCurrency(asset.purchase_cost)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Salvage Value</span>
              <span className="font-mono">{formatAssetCurrency(asset.salvage_value)}</span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Depreciable Amount</span>
              <span className="font-mono">
                {formatAssetCurrency(asset.purchase_cost - asset.salvage_value)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Accumulated Depreciation</span>
              <span className="font-mono text-amber-600">
                ({formatAssetCurrency(asset.accumulated_depreciation)})
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Net Book Value</span>
              <span className="font-mono font-medium">
                {formatAssetCurrency(asset.purchase_cost - asset.accumulated_depreciation)}
              </span>
            </div>
            {lastDepreciationDate && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Last Depreciation</span>
                <span>{formatDate(lastDepreciationDate)}</span>
              </div>
            )}
          </div>

          {/* Status Alerts */}
          {isFullyDepreciated && (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertTitle>Fully Depreciated</AlertTitle>
              <AlertDescription>
                This asset has been fully depreciated to its salvage value.
              </AlertDescription>
            </Alert>
          )}

          {isDisposed && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Asset Disposed</AlertTitle>
              <AlertDescription>
                This asset has been disposed and cannot be depreciated further.
              </AlertDescription>
            </Alert>
          )}

          {!hasRequiredAccounts && canDepreciate && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Missing Accounts</AlertTitle>
              <AlertDescription>
                Please configure the depreciation expense and accumulated depreciation
                accounts in the asset's settings before posting depreciation.
              </AlertDescription>
            </Alert>
          )}

          {/* Depreciation Form */}
          {canDepreciate && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium">New Depreciation Period</h3>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="period-start">Period Start</Label>
                  <Input
                    id="period-start"
                    type="date"
                    value={periodStart}
                    onChange={(e) => {
                      setPeriodStart(e.target.value);
                      setHasCalculated(false);
                      setPreview(null);
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="period-end">Period End</Label>
                  <Input
                    id="period-end"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => {
                      setPeriodEnd(e.target.value);
                      setHasCalculated(false);
                      setPreview(null);
                    }}
                  />
                </div>
              </div>

              <Button
                onClick={handleCalculate}
                disabled={!periodStart || !periodEnd || isCalculating}
                variant="outline"
                className="w-full"
              >
                {isCalculating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Calculate Preview
              </Button>

              {/* Preview Results */}
              {preview && (
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="font-medium flex items-center gap-2">
                    <Calculator className="h-4 w-4" />
                    Depreciation Preview
                  </h4>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Monthly Rate</span>
                      <span className="font-mono">
                        {formatAssetCurrency(preview.monthly_depreciation)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Months in Period</span>
                      <span>{preview.months_in_period}</span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-medium">
                      <span>Depreciation Amount</span>
                      <span className="font-mono text-amber-600">
                        {formatAssetCurrency(preview.depreciation_amount)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">New Accumulated</span>
                      <span className="font-mono">
                        {formatAssetCurrency(preview.new_accumulated)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">New Net Book Value</span>
                      <span className="font-mono">
                        {formatAssetCurrency(preview.net_book_value)}
                      </span>
                    </div>
                  </div>

                  {preview.is_fully_depreciated && (
                    <Alert className="mt-3">
                      <CheckCircle2 className="h-4 w-4" />
                      <AlertDescription>
                        This will fully depreciate the asset to its salvage value.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handlePost}
                    disabled={isPosting || !hasRequiredAccounts}
                    className="w-full"
                  >
                    {isPosting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Post Depreciation & Create Journal Entry
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Depreciation History */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Depreciation History
            </h3>

            {isLoadingHistory ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <Calendar className="h-8 w-8 mx-auto mb-2 opacity-50" />
                No depreciation has been posted yet.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Net Book Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm">
                              {formatPeriod(entry.period_start_date, entry.period_end_date)}
                            </span>
                            {entry.journal_entries && (
                              <span className="text-xs text-muted-foreground">
                                JE: {entry.journal_entries.entry_number}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-amber-600">
                          ({formatAssetCurrency(entry.depreciation_amount)})
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAssetCurrency(entry.net_book_value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
