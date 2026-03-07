import { useState, useMemo, useCallback } from 'react';

import { useQuery } from '@tanstack/react-query';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';

import { AlertCircle, ChevronDown, Info, Users } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';

import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';
import { computeAvgHourlyRateCents, computeMinStaffFromCrew } from '@/lib/staffingCalculator';
import { supabase } from '@/integrations/supabase/client';

import type { StaffingSuggestionsResult } from '@/hooks/useStaffingSuggestions';
import type { MinCrew } from '@/types/scheduling';

import { StaffingDayColumn } from './StaffingDayColumn';
import { StaffingConfigPanel } from './StaffingConfigPanel';

interface StaffingOverlayProps {
  restaurantId: string;
  weekDays: string[];
}

function useWeekStaffingSuggestions(
  restaurantId: string | null,
  weekDays: string[],
  settingsOverrides: Partial<StaffingSuggestionsResult> | null,
) {
  const { effectiveSettings, isLoading: settingsLoading, updateSettings, isSaving } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);

  const avgHourlyRateCents = useMemo(
    () => computeAvgHourlyRateCents(employees),
    [employees],
  );

  const employeePositions = useMemo(() => {
    if (!employees?.length) return [];
    const positions = new Set<string>();
    for (const emp of employees) {
      if (emp.position) positions.add(emp.position);
    }
    return Array.from(positions).sort();
  }, [employees]);

  // Merge DB settings with local overrides for live preview
  const activeSettings = useMemo(() => ({
    ...effectiveSettings,
    ...(settingsOverrides ?? {}),
  }), [effectiveSettings, settingsOverrides]);

  // Compute date range once for both queries
  const dateRange = useMemo(() => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - activeSettings.lookback_weeks * 7);
    return {
      startStr: startDate.toISOString().split('T')[0],
      endStr: endDate.toISOString().split('T')[0],
    };
  }, [activeSettings.lookback_weeks]);

  const { data: allSales, isLoading: salesLoading, error: salesError } = useQuery({
    queryKey: ['hourly-sales-all', restaurantId, activeSettings.lookback_weeks],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('unified_sales')
        .select('sale_date, sale_time, total_price')
        .eq('restaurant_id', restaurantId)
        .eq('item_type', 'sale')
        .gte('sale_date', dateRange.startStr)
        .lte('sale_date', dateRange.endStr)
        .order('sale_date');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  // Fetch time punches to compute actual labor hours for SPLH hint
  const { data: timePunches } = useQuery({
    queryKey: ['staffing-time-punches', restaurantId, activeSettings.lookback_weeks],
    queryFn: async () => {
      if (!restaurantId) return [];
      const { data, error } = await supabase
        .from('time_punches')
        .select('punch_time, punch_type, employee_id')
        .eq('restaurant_id', restaurantId)
        .gte('punch_time', dateRange.startStr)
        .lte('punch_time', dateRange.endStr + 'T23:59:59')
        .in('punch_type', ['in', 'out'])
        .order('employee_id')
        .order('punch_time');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  // Compute actual SPLH from historical sales and labor hours
  const actualSplh = useMemo(() => {
    if (!allSales?.length || !timePunches?.length) return null;

    const totalSales = allSales.reduce((sum, s) => sum + Number(s.total_price), 0);

    // Pair in/out punches per employee to compute hours
    let totalHours = 0;
    const lastIn: Record<string, string> = {};
    for (const punch of timePunches) {
      if (punch.punch_type === 'in') {
        lastIn[punch.employee_id] = punch.punch_time;
      } else if (punch.punch_type === 'out' && lastIn[punch.employee_id]) {
        const inTime = new Date(lastIn[punch.employee_id]).getTime();
        const outTime = new Date(punch.punch_time).getTime();
        const hours = (outTime - inTime) / (1000 * 60 * 60);
        if (hours > 0 && hours < 24) totalHours += hours;
        delete lastIn[punch.employee_id];
      }
    }

    if (totalHours <= 0) return null;
    return Math.round(totalSales / totalHours);
  }, [allSales, timePunches]);

  // Pre-group sales by day-of-week in a single pass (avoids 7x Date allocations)
  const salesByDow = useMemo(() => {
    if (!allSales?.length) return new Map<number, typeof allSales>();
    const grouped = new Map<number, typeof allSales>();
    for (const sale of allSales) {
      const dow = new Date(sale.sale_date + 'T12:00:00').getDay();
      if (!grouped.has(dow)) grouped.set(dow, []);
      grouped.get(dow)!.push(sale);
    }
    return grouped;
  }, [allSales]);

  const { daySuggestions, hasHourlyBreakdown } = useMemo(() => {
    if (!allSales?.length) return { daySuggestions: new Map<string, StaffingSuggestionsResult>(), hasHourlyBreakdown: false };

    const result = new Map<string, StaffingSuggestionsResult>();
    let anyHourly = false;
    for (const day of weekDays) {
      const dayOfWeek = new Date(day + 'T12:00:00').getDay();
      const filtered = salesByDow.get(dayOfWeek) ?? [];
      const aggregated = aggregateHourlySales(filtered);
      if (aggregated.hasHourlyBreakdown) anyHourly = true;
      result.set(day, computeStaffingSuggestions(aggregated.data, {
        targetSplh: activeSettings.target_splh,
        minStaff: computeMinStaffFromCrew(activeSettings.min_crew, activeSettings.min_staff),
        targetLaborPct: activeSettings.target_labor_pct,
        avgHourlyRateCents,
        day,
      }));
    }
    return { daySuggestions: result, hasHourlyBreakdown: anyHourly };
  }, [allSales, salesByDow, weekDays, activeSettings, avgHourlyRateCents]);

  return {
    daySuggestions,
    isLoading: settingsLoading || salesLoading,
    error: salesError,
    hasSalesData: (allSales?.length ?? 0) > 0,
    hasHourlyBreakdown,
    effectiveSettings,
    activeSettings,
    updateSettings,
    isSaving,
    employeePositions,
    actualSplh,
  };
}

export function StaffingOverlay({
  restaurantId,
  weekDays,
}: Readonly<StaffingOverlayProps>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mixed types for settings overrides
  const [localSettings, setLocalSettings] = useState<Record<string, any> | null>(null);

  const {
    daySuggestions,
    isLoading,
    error,
    hasSalesData,
    hasHourlyBreakdown,
    activeSettings,
    updateSettings,
    isSaving,
    employeePositions,
    actualSplh,
  } = useWeekStaffingSuggestions(restaurantId, weekDays, localSettings);

  const handleSettingsChange = useCallback((updates: Record<string, unknown>) => {
    setLocalSettings((prev) => ({ ...(prev ?? {}), ...updates }));
  }, []);

  const handleSaveDefaults = useCallback(async () => {
    if (!localSettings) return;
    try {
      await updateSettings(localSettings);
      setLocalSettings(null);
      toast({ title: 'Staffing defaults saved' });
    } catch {
      toast({ title: 'Failed to save defaults', variant: 'destructive' });
    }
  }, [localSettings, updateSettings, toast]);

  // Compute summary + peak in a single pass
  const summary = useMemo(() => {
    let totalSales = 0;
    let totalLabor = 0;
    let peakStaff = 0;

    for (const suggestions of daySuggestions.values()) {
      totalSales += suggestions.totalProjectedSales;
      totalLabor += suggestions.totalEstimatedLaborCost;
      if (suggestions.peakStaff > peakStaff) peakStaff = suggestions.peakStaff;
    }

    const laborPct = totalSales > 0 ? (totalLabor / totalSales) * 100 : 0;
    return { totalSales, totalLabor, peakStaff, laborPct };
  }, [daySuggestions]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-xl border border-border/40 bg-background overflow-hidden">
        <CollapsibleTrigger asChild>
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
            aria-label={isExpanded ? 'Collapse staffing suggestions' : 'Expand staffing suggestions'}
          >
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-[14px] font-medium text-foreground">Staffing Suggestions</span>
              {!isExpanded && hasSalesData && summary.peakStaff > 0 && (
                <span className="text-[12px] text-muted-foreground ml-2">
                  Peak {summary.peakStaff} staff/hr &middot; Labor {summary.laborPct.toFixed(1)}% of sales
                </span>
              )}
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          {isLoading ? (
            <div className="px-4 py-6">
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          ) : error ? (
            <div className="px-4 py-6 flex items-center gap-2 text-[13px] text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span>Failed to load sales data. Try again later.</span>
            </div>
          ) : (
            <>
              <StaffingConfigPanel
                settings={activeSettings}
                onSettingsChange={handleSettingsChange}
                onSaveDefaults={handleSaveDefaults}
                isSaving={isSaving}
                employeePositions={employeePositions}
                actualSplh={actualSplh}
                lookbackWeeks={activeSettings.lookback_weeks}
              />

              {/* How it works explainer */}
              {hasSalesData && (
                <div className="flex items-start gap-2 px-4 py-2.5 border-b border-border/40 bg-blue-500/5">
                  <Info className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
                  <div className="text-[12px] text-muted-foreground leading-relaxed">
                    <span className="font-medium text-foreground">How this works:</span>{' '}
                    We look at your last {activeSettings.lookback_weeks} weeks of sales for each day of the week.{' '}
                    {hasHourlyBreakdown
                      ? 'Each bar shows the recommended number of staff for that hour based on your sales history.'
                      : 'Since your POS does not include timestamps, daily sales are spread evenly across business hours (9am–10pm). The actual busy and slow hours may vary.'
                    }{' '}
                    Staff per hour = projected sales ÷ ${activeSettings.target_splh} target.{' '}
                    {(() => {
                      const crewFloor = computeMinStaffFromCrew(activeSettings.min_crew, activeSettings.min_staff);
                      if (activeSettings.min_crew && Object.keys(activeSettings.min_crew).length > 0) {
                        return `Your minimum crew (${Object.entries(activeSettings.min_crew).map(([pos, n]) => `${n} ${pos}`).join(', ')}) sets a floor of ${crewFloor} staff per hour. `;
                      }
                      if (crewFloor > 1) {
                        return `A minimum of ${crewFloor} staff is always shown. `;
                      }
                      return null;
                    })()}
                    Amber bars mean labor cost exceeds your {activeSettings.target_labor_pct}% target.
                  </div>
                </div>
              )}

              {/* Day columns grid — matches TemplateGrid layout */}
              <div className="grid grid-cols-[200px_repeat(7,1fr)] min-w-[1000px]">
                <div className="px-3 py-2 flex flex-col justify-center gap-1">
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Staff per Hour
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <div className="h-[8px] w-[14px] rounded-sm bg-blue-500/20 border border-blue-500/30" />
                      <span className="text-[10px] text-muted-foreground">On target</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="h-[8px] w-[14px] rounded-sm bg-amber-500/30 border border-amber-500/40" />
                      <span className="text-[10px] text-muted-foreground">Over budget</span>
                    </div>
                  </div>
                </div>
                {weekDays.map((day) => {
                  const daySugg = daySuggestions.get(day);
                  return (
                    <StaffingDayColumn
                      key={day}
                      day={day}
                      recommendations={daySugg?.recommendations ?? []}
                      peakStaff={summary.peakStaff}
                      hasSalesData={hasSalesData && (daySugg?.recommendations.length ?? 0) > 0}
                      hasHourlyBreakdown={hasHourlyBreakdown}
                    />
                  );
                })}
              </div>

              {/* Summary row */}
              {hasSalesData && summary.totalSales > 0 && (
                <div className="flex items-center gap-6 px-4 py-2.5 border-t border-border/40 bg-muted/20">
                  <div className="text-[12px] text-muted-foreground">
                    Projected weekly sales:{' '}
                    <span className="font-medium text-foreground">
                      ${Math.round(summary.totalSales).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    Estimated labor cost:{' '}
                    <span className="font-medium text-foreground">
                      ${Math.round(summary.totalLabor).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    Labor as % of sales:{' '}
                    <span className={`font-medium ${summary.laborPct > activeSettings.target_labor_pct ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                      {summary.laborPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}
            </>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
