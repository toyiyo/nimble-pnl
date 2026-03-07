import { useState, useMemo, useCallback } from 'react';

import { useQuery } from '@tanstack/react-query';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';

import { ChevronDown, Users } from 'lucide-react';

import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { aggregateHourlySales } from '@/hooks/useHourlySalesPattern';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';
import { supabase } from '@/integrations/supabase/client';

import type { StaffingSuggestionsResult } from '@/hooks/useStaffingSuggestions';

import { StaffingDayColumn } from './StaffingDayColumn';
import { StaffingConfigPanel } from './StaffingConfigPanel';

interface StaffingOverlayProps {
  restaurantId: string;
  weekDays: string[];
}

function useWeekStaffingSuggestions(restaurantId: string | null, weekDays: string[]) {
  const { effectiveSettings, isLoading: settingsLoading, updateSettings, isSaving } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);

  const avgHourlyRateCents = useMemo(() => {
    if (!employees?.length) return 1500;
    const hourlyEmployees = employees.filter(
      (e: any) => e.compensation_type === 'hourly' && e.is_active,
    );
    if (hourlyEmployees.length === 0) return 1500;
    return Math.round(
      hourlyEmployees.reduce((sum: number, e: any) => sum + e.hourly_rate, 0) / hourlyEmployees.length,
    );
  }, [employees]);

  const { data: allSales, isLoading: salesLoading } = useQuery({
    queryKey: ['hourly-sales-all', restaurantId, effectiveSettings.lookback_weeks],
    queryFn: async () => {
      if (!restaurantId) return [];
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - effectiveSettings.lookback_weeks * 7);
      const { data, error } = await supabase
        .from('unified_sales')
        .select('sale_date, sale_time, total_price')
        .eq('restaurant_id', restaurantId)
        .eq('item_type', 'sale')
        .gte('sale_date', startDate.toISOString().split('T')[0])
        .lte('sale_date', endDate.toISOString().split('T')[0])
        .not('sale_time', 'is', null)
        .order('sale_date');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!restaurantId,
    staleTime: 60000,
  });

  const daySuggestions = useMemo(() => {
    if (!allSales?.length) return new Map<string, StaffingSuggestionsResult>();

    const result = new Map<string, StaffingSuggestionsResult>();
    for (const day of weekDays) {
      const dayOfWeek = new Date(day + 'T12:00:00').getDay();
      const filtered = allSales.filter((sale: any) => {
        const d = new Date(sale.sale_date + 'T12:00:00');
        return d.getDay() === dayOfWeek;
      });
      const hourlySales = aggregateHourlySales(filtered);
      result.set(day, computeStaffingSuggestions(hourlySales, {
        targetSplh: effectiveSettings.target_splh,
        minStaff: effectiveSettings.min_staff,
        targetLaborPct: effectiveSettings.target_labor_pct,
        avgHourlyRateCents,
        day,
      }));
    }
    return result;
  }, [allSales, weekDays, effectiveSettings, avgHourlyRateCents]);

  return {
    daySuggestions,
    isLoading: settingsLoading || salesLoading,
    hasSalesData: (allSales?.length ?? 0) > 0,
    effectiveSettings,
    updateSettings,
    isSaving,
  };
}

export function StaffingOverlay({
  restaurantId,
  weekDays,
}: Readonly<StaffingOverlayProps>) {
  const [isExpanded, setIsExpanded] = useState(false);

  const {
    daySuggestions,
    isLoading,
    hasSalesData,
    effectiveSettings,
    updateSettings,
    isSaving,
  } = useWeekStaffingSuggestions(restaurantId, weekDays);

  const [localSettings, setLocalSettings] = useState<typeof effectiveSettings | null>(null);
  const activeSettings = localSettings ?? effectiveSettings;

  const handleSettingsChange = useCallback((updates: Partial<typeof effectiveSettings>) => {
    setLocalSettings((prev) => ({ ...(prev ?? effectiveSettings), ...updates }));
  }, [effectiveSettings]);

  const handleSaveDefaults = useCallback(async () => {
    if (!localSettings) return;
    await updateSettings({
      target_splh: localSettings.target_splh,
      avg_ticket_size: localSettings.avg_ticket_size,
      target_labor_pct: localSettings.target_labor_pct,
      min_staff: localSettings.min_staff,
    });
    setLocalSettings(null);
  }, [localSettings, updateSettings]);

  // Compute summary across all days
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

  // Global peak for normalizing bar heights
  const globalPeak = useMemo(() => {
    let peak = 0;
    for (const suggestions of daySuggestions.values()) {
      if (suggestions.peakStaff > peak) peak = suggestions.peakStaff;
    }
    return peak;
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
                  Peak: {summary.peakStaff} staff &middot; Est. labor: {summary.laborPct.toFixed(1)}%
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
          ) : (
            <>
              <StaffingConfigPanel
                settings={activeSettings}
                onSettingsChange={handleSettingsChange}
                onSaveDefaults={handleSaveDefaults}
                isSaving={isSaving}
              />

              {/* Day columns grid — matches TemplateGrid layout */}
              <div className="grid grid-cols-[200px_repeat(7,1fr)] min-w-[1000px]">
                <div className="px-3 py-2 flex items-center">
                  <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                    Hourly
                  </span>
                </div>
                {weekDays.map((day) => {
                  const daySugg = daySuggestions.get(day);
                  return (
                    <StaffingDayColumn
                      key={day}
                      day={day}
                      recommendations={daySugg?.recommendations ?? []}
                      peakStaff={globalPeak}
                      hasSalesData={hasSalesData && (daySugg?.recommendations.length ?? 0) > 0}
                    />
                  );
                })}
              </div>

              {/* Summary row */}
              {hasSalesData && summary.totalSales > 0 && (
                <div className="flex items-center gap-6 px-4 py-2.5 border-t border-border/40 bg-muted/20">
                  <div className="text-[12px] text-muted-foreground">
                    Projected sales:{' '}
                    <span className="font-medium text-foreground">
                      ${Math.round(summary.totalSales).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    Est. labor:{' '}
                    <span className="font-medium text-foreground">
                      ${Math.round(summary.totalLabor).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    Labor %:{' '}
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
