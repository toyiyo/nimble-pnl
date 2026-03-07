import { memo } from 'react';

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

  return (
    <div
      className="flex flex-col gap-px border-l border-border/40 px-1 py-1"
      aria-label={`Staffing recommendations for ${day}`}
    >
      {recommendations.map((rec) => {
        const heightPct = Math.max((rec.recommendedStaff / maxStaff) * 100, 12);
        return (
          <div
            key={rec.hour}
            className="flex items-center gap-0.5 min-h-[14px]"
            title={`${formatHourLabel(rec.hour)}: ${rec.recommendedStaff} staff, $${Math.round(rec.projectedSales)} projected`}
          >
            <span className="text-[9px] text-muted-foreground w-[22px] text-right shrink-0">
              {formatHourLabel(rec.hour)}
            </span>
            <div className="flex-1 h-[12px] relative">
              <div
                className={`h-full rounded-sm transition-all ${
                  rec.overTarget
                    ? 'bg-amber-500/30 border border-amber-500/40'
                    : 'bg-blue-500/20 border border-blue-500/30'
                }`}
                style={{ width: `${heightPct}%` }}
              />
            </div>
            <span className="text-[9px] font-medium text-foreground w-[12px] shrink-0">
              {rec.recommendedStaff}
            </span>
          </div>
        );
      })}
    </div>
  );
});
