import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import {
  Users,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronRight,
  Upload,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';

import { useGustoFlows } from '@/hooks/useGustoFlows';
import { useGustoEmployeeSync } from '@/hooks/useGustoEmployeeSync';

import { PayrollPeriod, EmployeePayroll, formatCurrency, formatHours } from '@/utils/payrollCalculations';

import { supabase } from '@/integrations/supabase/client';

interface PayrollGustoProcessorProps {
  restaurantId: string;
  payrollPeriod: PayrollPeriod | null;
  startDate: string;
  endDate: string;
}

type ProcessorState = 'idle' | 'syncing_hours' | 'preparing_payroll' | 'done' | 'error';

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-border/40 bg-muted/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-8 w-8 rounded-lg bg-muted/50 flex items-center justify-center">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="text-[17px] font-semibold text-foreground">{value}</p>
    </div>
  );
}

function EmployeeRow({ emp }: { emp: EmployeePayroll }) {
  return (
    <tr className="border-b border-border/40 last:border-0">
      <td className="py-2.5 px-3 text-[14px] font-medium text-foreground">
        {emp.employeeName}
      </td>
      <td className="py-2.5 px-3 text-[13px] text-muted-foreground text-right tabular-nums">
        {formatHours(emp.regularHours)}
      </td>
      <td className="py-2.5 px-3 text-[13px] text-muted-foreground text-right tabular-nums">
        {formatHours(emp.overtimeHours)}
      </td>
      <td className="py-2.5 px-3 text-[13px] text-muted-foreground text-right tabular-nums">
        {formatCurrency(emp.totalTips)}
      </td>
      <td className="py-2.5 px-3 text-[14px] font-medium text-foreground text-right tabular-nums">
        {formatCurrency(emp.grossPay)}
      </td>
    </tr>
  );
}

export function PayrollGustoProcessor({
  restaurantId,
  payrollPeriod,
  startDate,
  endDate,
}: PayrollGustoProcessorProps) {
  const [state, setState] = useState<ProcessorState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const { syncTimePunches, isSyncingTimePunches } = useGustoEmployeeSync(restaurantId);
  const {
    flowUrl,
    isLoading: isFlowLoading,
    generateFlowUrl,
    clearFlow,
  } = useGustoFlows(restaurantId);

  if (!payrollPeriod || payrollPeriod.employees.length === 0) {
    return null;
  }

  const { employees, totalRegularHours, totalOvertimeHours, totalGrossPay } = payrollPeriod;
  const totalHours = totalRegularHours + totalOvertimeHours;

  const handleProcess = async () => {
    setState('syncing_hours');
    setErrorMessage(null);

    try {
      await syncTimePunches(startDate, endDate);

      setState('preparing_payroll');
      const { error } = await supabase.functions.invoke('gusto-prepare-payroll', {
        body: {
          restaurantId,
          startDate,
          endDate,
        },
      });

      if (error) {
        throw new Error(error.message || 'Failed to prepare payroll');
      }

      await generateFlowUrl('run_payroll');

      setState('done');
    } catch (err: unknown) {
      setState('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'An unexpected error occurred'
      );
    }
  };

  const handleRetry = () => {
    clearFlow();
    setState('idle');
    setErrorMessage(null);
  };

  const isProcessing = state === 'syncing_hours' || state === 'preparing_payroll';

  function getButtonLabel(): string {
    switch (state) {
      case 'syncing_hours':
        return 'Syncing Hours...';
      case 'preparing_payroll':
        return 'Preparing Payroll...';
      default:
        return 'Sync to Gusto & Process Payroll';
    }
  }

  return (
    <div className="space-y-5">
      {/* Summary Metric Cards */}
      <div className="flex gap-3">
        <MetricCard
          icon={Users}
          label="Employees"
          value={String(employees.length)}
        />
        <MetricCard
          icon={Clock}
          label="Total Hours"
          value={formatHours(totalHours)}
        />
        <MetricCard
          icon={DollarSign}
          label="Est. Gross"
          value={formatCurrency(totalGrossPay)}
        />
      </div>

      {/* Collapsible Review Details */}
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-label={detailsOpen ? 'Collapse review details' : 'Expand review details'}
          >
            {detailsOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Review Details
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/50">
                    <th className="py-2 px-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="py-2 px-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                      Regular Hrs
                    </th>
                    <th className="py-2 px-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                      OT Hrs
                    </th>
                    <th className="py-2 px-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                      Tips
                    </th>
                    <th className="py-2 px-3 text-[12px] font-medium text-muted-foreground uppercase tracking-wider text-right">
                      Gross
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((emp) => (
                    <EmployeeRow key={emp.employeeId} emp={emp} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Error State */}
      {state === 'error' && errorMessage && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-[13px] text-destructive flex-1">{errorMessage}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRetry}
            className="h-8 px-3 rounded-lg text-[13px] font-medium text-muted-foreground hover:text-foreground"
            aria-label="Retry payroll processing"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Done State with Gusto Flow iframe */}
      {state === 'done' && flowUrl && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <p className="text-[13px] text-emerald-700 dark:text-emerald-300">
              Hours synced and payroll prepared. Complete your payroll run below.
            </p>
          </div>
          <div className="rounded-xl border border-border/40 overflow-hidden">
            <iframe
              src={flowUrl}
              title="Gusto Run Payroll"
              className="w-full h-[700px] border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              allow="clipboard-write"
            />
          </div>
        </div>
      )}

      {/* Done state without flow URL (flow still loading) */}
      {state === 'done' && !flowUrl && isFlowLoading && (
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">Loading Gusto payroll...</span>
        </div>
      )}

      {/* Action Button (hidden in done/error states) */}
      {(state === 'idle' || isProcessing) && (
        <Button
          onClick={handleProcess}
          disabled={isProcessing}
          className="h-9 px-4 rounded-lg bg-foreground text-background hover:bg-foreground/90 text-[13px] font-medium w-full"
          aria-label="Sync time punches to Gusto and process payroll"
        >
          {isProcessing ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5 mr-2" />
          )}
          {getButtonLabel()}
        </Button>
      )}
    </div>
  );
}
