import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ShoppingCart, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReceiptStatusBarProps {
  vendorName: string | null;
  purchaseDate: string | null;
  totalAmount: number | null;
  readyCount: number;
  needsReviewCount: number;
  skippedCount: number;
  totalCount: number;
  isImporting: boolean;
  isImported: boolean;
  onImport: () => void;
  showAutoApproved: boolean;
  onToggleAutoApproved: () => void;
}

export const ReceiptStatusBar: React.FC<ReceiptStatusBarProps> = ({
  vendorName,
  purchaseDate,
  totalAmount,
  readyCount,
  needsReviewCount,
  skippedCount,
  totalCount,
  isImporting,
  isImported,
  onImport,
  showAutoApproved,
  onToggleAutoApproved,
}) => {
  const progressValue = totalCount > 0 ? ((readyCount + skippedCount) / totalCount) * 100 : 0;
  const canImport = needsReviewCount === 0 && readyCount > 0;

  const formatCurrency = (amount: number | null) => {
    if (!amount) return '';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (isImported) {
    return (
      <div className="sticky top-0 z-10 bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <span className="font-medium text-green-800 dark:text-green-200">
                Receipt Imported Successfully
              </span>
              <span className="text-sm text-green-600 dark:text-green-400 ml-2">
                {totalCount} items added to inventory
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b px-6 py-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-semibold text-lg">{vendorName || 'Receipt'}</span>
            {purchaseDate && (
              <span className="text-muted-foreground ml-2">• {purchaseDate}</span>
            )}
            {totalAmount && (
              <span className="text-muted-foreground ml-2">• {formatCurrency(totalAmount)}</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleAutoApproved}
            className="text-muted-foreground"
            aria-label={showAutoApproved ? "Hide auto-approved items" : "Show auto-approved items"}
          >
            {showAutoApproved ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
            {showAutoApproved ? 'Hide' : 'Show'} ready
          </Button>
          
          <Button
            onClick={onImport}
            disabled={isImporting || !canImport}
            className={cn(
              "flex items-center gap-2 transition-all",
              canImport && "bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70"
            )}
            size="default"
          >
            <ShoppingCart className="w-4 h-4" />
            {isImporting ? 'Importing...' : `Import ${readyCount} Items`}
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <Progress value={progressValue} className="h-2" />
        <div className="flex items-center gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">{readyCount} ready</span>
          </div>
          {needsReviewCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-amber-600 dark:text-amber-400 font-medium">
                {needsReviewCount} need review
              </span>
            </div>
          )}
          {skippedCount > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
              <span className="text-muted-foreground">{skippedCount} skipped</span>
            </div>
          )}
        </div>
      </div>

      {/* Warning banner */}
      {needsReviewCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800">
          <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-700 dark:text-amber-300">
            Review {needsReviewCount} item{needsReviewCount > 1 ? 's' : ''} before importing
          </span>
        </div>
      )}
    </div>
  );
};
