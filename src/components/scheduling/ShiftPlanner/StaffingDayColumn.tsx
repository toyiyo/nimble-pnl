import { memo } from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import type { HourlyStaffingRecommendation } from '@/types/scheduling';

interface StaffingDayColumnProps {
  day: string;
  recommendations: HourlyStaffingRecommendation[];
  peakStaff: number;
  hasSalesData: boolean;
}

function formatHourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

export const StaffingDayColumn = memo(function StaffingDayColumn({
  day,
  recommendations,
  peakStaff,
  hasSalesData,
}: Readonly<StaffingDayColumnProps>) {
  if (!hasSalesData || recommendations.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-full border-l border-border/40 px-1"
        aria-label={`No staffing data for ${day}`}
      >
        <span className="text-[11px] text-muted-foreground/60">No data</span>
      </div>
    );
  }

  const maxStaff = peakStaff || 1;
  const totalSales = recommendations.reduce((sum, r) => sum + r.projectedSales, 0);
  const totalStaffHours = recommendations.reduce((sum, r) => sum + r.recommendedStaff, 0);

  return (
    <div
      className="flex flex-col border-l border-border/40 px-1 py-1"
      aria-label={`Staffing recommendations for ${day}`}
    >
      {/* Day summary */}
      <div className="flex items-center justify-between px-0.5 pb-1 mb-0.5 border-b border-border/20">
        <span className="text-[10px] text-muted-foreground">{formatCurrency(totalSales)}</span>
        <span className="text-[10px] font-medium text-foreground">{totalStaffHours}h</span>
      </div>

      {/* Hourly bars */}
      <div className="flex flex-col gap-px">
        <TooltipProvider delayDuration={150}>
          {recommendations.map((rec) => {
            const widthPct = Math.max((rec.recommendedStaff / maxStaff) * 100, 12);
            const isOverTarget = rec.overTarget;
            return (
              <Tooltip key={rec.hour}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 min-h-[14px] cursor-default">
                    <span className="text-[9px] text-muted-foreground w-[22px] text-right shrink-0">
                      {formatHourLabel(rec.hour)}
                    </span>
                    <div className="flex-1 h-[12px] relative">
                      <div
                        className={`h-full rounded-sm transition-all ${
                          isOverTarget
                            ? 'bg-amber-500/30 border border-amber-500/40'
                            : 'bg-blue-500/20 border border-blue-500/30'
                        }`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-medium text-foreground w-[12px] shrink-0">
                      {rec.recommendedStaff}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[12px] space-y-0.5">
                  <div className="font-medium">{formatHourLabel(rec.hour)} — {rec.recommendedStaff} staff</div>
                  <div className="text-muted-foreground">
                    Projected sales: {formatCurrency(rec.projectedSales)}
                  </div>
                  <div className={isOverTarget ? 'text-amber-500' : 'text-muted-foreground'}>
                    Labor cost: {rec.laborPct.toFixed(0)}% of sales
                    {isOverTarget ? ' (over target)' : ''}
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </TooltipProvider>
      </div>
    </div>
  );
});
