import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Edit, Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedSaleItem } from "@/types/pos";
import { format } from "date-fns";

interface SplitSaleViewProps {
  sale: UnifiedSaleItem;
  onEdit?: (sale: UnifiedSaleItem) => void;
  onSplit?: (sale: UnifiedSaleItem) => void;
  formatCurrency: (amount: number) => string;
}

export function SplitSaleView({ sale, onEdit, onSplit, formatCurrency }: SplitSaleViewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const childSplits = sale.child_splits || [];
  const totalSplitAmount = childSplits.reduce((sum, split) => sum + (split.totalPrice || 0), 0);

  return (
    <Card className="w-full transition-all hover:shadow-md border-l-4 border-l-blue-500">
      <CardContent className="p-4 space-y-3">
        {/* Parent Sale Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-semibold text-base">{sale.itemName}</h4>
              <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                Split Sale
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Qty: {sale.quantity}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(sale.saleDate), 'MMM dd, yyyy')}
              {sale.saleTime && ` at ${sale.saleTime}`}
              {' • Order: '}
              <span className="font-mono">{sale.externalOrderId}</span>
            </p>
          </div>
          
          <div className="text-right flex-shrink-0">
            <div className="text-lg font-bold">
              {formatCurrency(sale.totalPrice || 0)}
            </div>
            <Badge variant="outline" className="text-xs mt-1">
              {sale.posSystem}
            </Badge>
          </div>
        </div>

        {/* Split Children Summary */}
        <div className="flex items-center justify-between bg-muted/50 rounded-md p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-2 hover:bg-muted"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <span className="text-sm">
              {childSplits.length} split {childSplits.length === 1 ? 'item' : 'items'}
            </span>
          </Button>
          <span className="text-sm font-medium">
            Total: {formatCurrency(totalSplitAmount)}
          </span>
        </div>

        {/* Expanded Split Items */}
        {isExpanded && (
          <div className="space-y-2 pl-4 border-l-2 border-blue-200 dark:border-blue-800">
            {childSplits.map((split) => (
              <div
                key={split.id}
                className="flex items-center justify-between p-2 bg-background rounded-md border"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{split.itemName || 'Split Item'}</p>
                  {split.chart_account && (
                    <Badge variant="outline" className="text-xs mt-1">
                      {split.chart_account.account_code} - {split.chart_account.account_name}
                    </Badge>
                  )}
                </div>
                <div className="text-right flex-shrink-0 ml-2">
                  <span className="text-sm font-semibold">
                    {formatCurrency(split.totalPrice || 0)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2 pt-2">
          {onEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onEdit(sale)}
              className="flex-1"
            >
              <Edit className="h-3 w-3 mr-1" />
              Edit
            </Button>
          )}
          {onSplit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSplit(sale)}
              className="flex-1"
              disabled
              title="Already split - cannot split again"
            >
              <Split className="h-3 w-3 mr-1" />
              Split
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
