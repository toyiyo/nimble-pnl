import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { useCashFlowInsights } from "@/hooks/useCashFlowInsights";
import { TimelineBrush } from "@/components/banking/cashflow/TimelineBrush";
import { CashFlowHeadline } from "@/components/banking/cashflow/CashFlowHeadline";
import { CashFlowNarrative } from "@/components/banking/cashflow/CashFlowNarrative";
import { CashFlowChart } from "@/components/banking/cashflow/CashFlowChart";
import { MoneyBreakdownTable } from "@/components/banking/cashflow/MoneyBreakdownTable";
import type { Period } from "@/components/PeriodSelector";

interface CashFlowTabProps {
  selectedPeriod: Period;
  selectedBankAccount: string;
  onPeriodChange: (period: Period) => void;
}

/**
 * Mercury-style cash flow view: brush, headline, a narrative|chart grid,
 * and Money in / Money out tables. Gated on the single
 * `useCashFlowInsights` result (CLAUDE.md three-state rule).
 */
export function CashFlowTab({ selectedPeriod, selectedBankAccount, onPeriodChange }: CashFlowTabProps) {
  const { data, isLoading, error, refetch } = useCashFlowInsights(selectedPeriod, selectedBankAccount);

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-destructive mb-4" />
          <p className="text-lg font-semibold mb-2">Failed to load cash flow data</p>
          <p className="text-sm text-muted-foreground mb-4">{error.message}</p>
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-live="polite" aria-label="Loading cash flow">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* Keep the brush visible so the user can brush back out of an empty range. */}
        <TimelineBrush selectedPeriod={selectedPeriod} onPeriodChange={onPeriodChange} />
        <div className="text-center py-12">
          <p className="text-muted-foreground">No transactions for this period</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {data.truncated && (
        <p className="text-[13px] text-muted-foreground">
          This period has more transactions than we could load. Totals may be incomplete.
        </p>
      )}

      <TimelineBrush selectedPeriod={selectedPeriod} onPeriodChange={onPeriodChange} />

      <CashFlowHeadline totals={data.aggregates.totals} />

      {/* The chart needs the width: two of three columns on large screens. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-border/40 bg-background p-4 lg:col-span-1">
          <CashFlowNarrative insights={data.insights} />
        </div>
        <div className="rounded-xl border border-border/40 bg-background p-4 lg:col-span-2">
          <CashFlowChart rows={data.rows} period={selectedPeriod} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <MoneyBreakdownTable
          title="Money in"
          total={data.aggregates.totals.moneyIn}
          primaryTabLabel="Source"
          primaryRows={data.sources}
          categoryRows={data.categoryBreakdownIn}
        />
        <MoneyBreakdownTable
          title="Money out"
          total={data.aggregates.totals.moneyOut}
          primaryTabLabel="Recipient"
          primaryRows={data.recipients}
          categoryRows={data.categoryBreakdownOut}
        />
      </div>
    </div>
  );
}
