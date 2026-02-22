import { memo } from 'react';

import { Badge } from '@/components/ui/badge';

import { TrendingDown, TrendingUp, Package, AlertTriangle } from 'lucide-react';

import type { AuditDisplayValues } from '@/lib/inventoryAuditUtils';

export interface AuditTransactionRowData {
  id: string;
  product_name: string;
  quantity: number;
  transaction_type: string;
  reason: string | null;
  reference_id: string | null;
}

export interface MemoizedAuditTransactionRowProps {
  transaction: AuditTransactionRowData;
  displayValues: AuditDisplayValues;
}

const TRANSACTION_ICONS: Record<string, JSX.Element> = {
  purchase: <TrendingUp className="h-3.5 w-3.5" />,
  usage: <TrendingDown className="h-3.5 w-3.5" />,
  adjustment: <Package className="h-3.5 w-3.5" />,
  waste: <AlertTriangle className="h-3.5 w-3.5" />,
};
const DEFAULT_ICON = <Package className="h-3.5 w-3.5" />;

export const MemoizedAuditTransactionRow = memo(function MemoizedAuditTransactionRow({
  transaction,
  displayValues,
}: MemoizedAuditTransactionRowProps) {
  const {
    formattedQuantity,
    formattedUnitCost,
    formattedTotalCost,
    formattedDate,
    isPositiveQuantity,
    isPositiveCost,
    badgeColor,
    borderColor,
    conversionBadges,
  } = displayValues;

  return (
    <div
      className={`border-l-4 ${borderColor} p-4 rounded-xl border border-border/40 bg-background hover:border-border transition-colors`}
      role="listitem"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex-1 space-y-2.5">
          {/* Badge + Product Name */}
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge
              variant="secondary"
              className={`${badgeColor} flex items-center gap-1 px-2 py-0.5 text-[12px]`}
            >
              {TRANSACTION_ICONS[transaction.transaction_type] || DEFAULT_ICON}
              <span className="font-medium capitalize">{transaction.transaction_type}</span>
            </Badge>
            <h3 className="text-[14px] font-medium text-foreground leading-tight">{transaction.product_name}</h3>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Quantity
              </div>
              <div className={`text-[15px] font-semibold leading-none ${isPositiveQuantity ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formattedQuantity}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Unit Cost
              </div>
              <div className="text-[15px] font-semibold leading-none text-foreground">
                {formattedUnitCost}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Total Cost
              </div>
              <div className={`text-[15px] font-semibold leading-none ${isPositiveCost ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formattedTotalCost}
              </div>
            </div>

            <div className="space-y-0.5">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Date
              </div>
              <div className="text-[13px] font-medium text-foreground leading-tight">
                {formattedDate}
              </div>
            </div>
          </div>

          {/* Reason */}
          {transaction.reason && (
            <div className="pt-1 space-y-1">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Reason</div>
              <div className="flex flex-wrap items-start gap-2">
                <div className="text-[13px] text-muted-foreground leading-relaxed flex-1 min-w-0">{transaction.reason}</div>
                {conversionBadges.includes('fallback') && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 flex items-center gap-1 shrink-0 text-[11px]">
                    <AlertTriangle className="h-3 w-3" />
                    1:1 Fallback
                  </Badge>
                )}
                {conversionBadges.includes('volume') && (
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300 shrink-0 text-[11px]">
                    Volume
                  </Badge>
                )}
                {conversionBadges.includes('weight') && (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 shrink-0 text-[11px]">
                    Weight
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Reference ID */}
          {transaction.reference_id && (
            <div className="pt-1 space-y-1">
              <div className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Reference ID</div>
              <div className="text-[13px] font-mono bg-muted/30 rounded-lg px-2 py-1 break-all max-w-full border border-border/40">
                {transaction.reference_id}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.transaction.id === nextProps.transaction.id &&
    prevProps.displayValues === nextProps.displayValues
  );
});
