import { useState, useMemo, useCallback } from 'react';

import { Link } from 'react-router-dom';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Skeleton } from '@/components/ui/skeleton';

import { AlertCircle, ChevronDown, Info, Users } from 'lucide-react';

import { useToast } from '@/hooks/use-toast';

import { computeMinStaffFromCrew } from '@/lib/staffingCalculator';
import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';

import type { StaffingSettings } from '@/types/scheduling';

import { StaffingDayColumn } from './StaffingDayColumn';
import { StaffingConfigPanel } from './StaffingConfigPanel';
import { SuggestedShifts } from './SuggestedShifts';

interface StaffingOverlayProps {
  restaurantId: string;
  weekDays: string[];
}

export function StaffingOverlay({
  restaurantId,
  weekDays,
}: Readonly<StaffingOverlayProps>) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { toast } = useToast();
  const [localSettings, setLocalSettings] = useState<Partial<StaffingSettings> | null>(null);

  const {
    daySuggestions,
    isLoading,
    error,
    refetch,
    hasSalesData,
    hasHourlyBreakdown,
    activeSettings,
    updateSettings,
    isSaving,
    employeePositions,
    actualSplh,
  } = useWeekStaffingSuggestions(restaurantId, weekDays, localSettings);

  const handleSettingsChange = useCallback((updates: Partial<StaffingSettings>) => {
    setLocalSettings((prev) => ({ ...(prev ?? {}), ...updates }));
  }, []);

  const handleImmediateSettingsChange = useCallback(async (updates: Partial<StaffingSettings>) => {
    try {
      await updateSettings(updates);
      toast({ title: 'Setting saved' });
    } catch {
      toast({ title: 'Failed to save setting', variant: 'destructive' });
    }
  }, [updateSettings, toast]);

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

  // Aggregate shift blocks from all days for SuggestedShifts
  const allShiftBlocks = useMemo(
    () => [...daySuggestions.values()].flatMap((s) => s.shiftBlocks),
    [daySuggestions],
  );

  // Explainer note about the crew/staff floor (extracted from JSX for readability)
  const crewFloorNote = (() => {
    const crewFloor = computeMinStaffFromCrew(activeSettings.min_crew, activeSettings.min_staff);
    if (activeSettings.min_crew && Object.keys(activeSettings.min_crew).length > 0) {
      const crewDesc = Object.entries(activeSettings.min_crew)
        .map(([pos, n]) => `${n} ${pos}`)
        .join(', ');
      return `Your minimum crew (${crewDesc}) sets a floor of ${crewFloor} staff per hour. `;
    }
    if (crewFloor > 1) {
      return `A minimum of ${crewFloor} staff is always shown. `;
    }
    return null;
  })();

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
              <button
                onClick={() => refetch()}
                className="ml-2 text-[13px] font-medium text-foreground underline"
                aria-label="Retry"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <StaffingConfigPanel
                settings={activeSettings}
                onSettingsChange={handleSettingsChange}
                onImmediateSettingsChange={handleImmediateSettingsChange}
                onSaveDefaults={handleSaveDefaults}
                isSaving={isSaving}
                hasPendingChanges={localSettings !== null}
                employeePositions={employeePositions}
                actualSplh={actualSplh}
                lookbackWeeks={activeSettings.lookback_weeks}
              />

              {/* How it works explainer — always visible so it educates even with no data */}
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
                  {crewFloorNote}
                  Amber bars mean labor cost exceeds your {activeSettings.target_labor_pct}% target.
                </div>
              </div>

              {/* No-data empty state — shown when there is no sales history yet */}
              {!hasSalesData && (
                <div className="px-4 py-6 text-center space-y-2">
                  <p className="text-[13px] text-muted-foreground">
                    Staffing suggestions need sales history. Connect your POS or enter sales to see recommendations.
                  </p>
                  <Link
                    to="/integrations"
                    className="text-[13px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Connect your POS
                  </Link>
                </div>
              )}

              {/* Day columns grid — matches TemplateGrid layout (gated on hasSalesData) */}
              {hasSalesData && (
                <div className="grid grid-cols-[56px_repeat(7,1fr)] md:grid-cols-[200px_repeat(7,1fr)] min-w-[560px] md:min-w-[1000px]">
                  <div className="px-1 md:px-3 py-2 flex flex-col justify-center gap-1">
                    <span className="text-[10px] md:text-[12px] font-medium text-muted-foreground uppercase tracking-wider hidden md:block">
                      Staff per Hour
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider block md:hidden">
                      Staff
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
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
              )}

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

              {/* Suggested shift blocks — rendered whenever there is sales data */}
              {hasSalesData && (
                <SuggestedShifts
                  blocks={allShiftBlocks}
                  minCrew={activeSettings.min_crew}
                  restaurantId={restaurantId}
                  openShiftsEnabled={activeSettings.open_shifts_enabled}
                />
              )}
            </>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
