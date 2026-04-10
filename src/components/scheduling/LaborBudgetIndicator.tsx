import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import type { LaborBudgetData } from '@/hooks/useScheduleLaborBudget';

interface LaborBudgetIndicatorProps {
  budgetData: LaborBudgetData;
}

const tierColors = {
  success: {
    text: 'text-success',
    bg: 'bg-success/[0.06]',
    border: 'border-success/15',
    bar: 'bg-success/60',
  },
  warning: {
    text: 'text-warning',
    bg: 'bg-warning/[0.06]',
    border: 'border-warning/20',
    bar: 'bg-warning/60',
  },
  danger: {
    text: 'text-destructive/80',
    bg: 'bg-destructive/[0.05]',
    border: 'border-destructive/20',
    bar: 'bg-destructive/60',
  },
};

function formatCurrency(value: number): string {
  return `$${Math.abs(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function getVarianceLabel(variance: number, percentage: number): string {
  if (percentage <= 80) return `${formatCurrency(variance)} under budget`;
  if (percentage <= 100) return `${formatCurrency(variance)} remaining`;
  return `${formatCurrency(variance)} over budget`;
}

export function LaborBudgetIndicator({ budgetData }: LaborBudgetIndicatorProps) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  if (budgetData.isLoading) {
    return (
      <div className="mt-3 pt-3 border-t border-border/50">
        <Skeleton className="h-4 w-20" />
      </div>
    );
  }

  const colors = tierColors[budgetData.tier];
  const barWidth = Math.min(budgetData.percentage, 100);

  return (
    <div className="mt-3 pt-3 border-t border-border/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={expanded}
        aria-label="Toggle budget comparison"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Budget
      </button>

      {expanded && (
        <div className="mt-2">
          {budgetData.hasBudget ? (
            <div
              className={cn(
                'p-2.5 rounded-lg border',
                colors.bg,
                colors.border,
              )}
            >
              <div className="flex justify-between items-baseline mb-1.5">
                <span className={cn('text-[18px] font-semibold', colors.text)}>
                  {budgetData.percentage.toFixed(0)}%
                </span>
                <span className="text-[11px] text-muted-foreground">
                  of {formatCurrency(budgetData.weeklyTarget)}/wk
                </span>
              </div>
              <div className="h-[5px] bg-border/30 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', colors.bar)}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <div className={cn('text-[11px] mt-1.5', colors.text)}>
                {getVarianceLabel(budgetData.variance, budgetData.percentage)}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg border border-border/40 bg-muted/30">
              <div className="flex justify-between items-center">
                <span className="text-[12px] text-muted-foreground">
                  No labor budget set
                </span>
                <button
                  onClick={() => navigate('/budget')}
                  className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Configure →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
