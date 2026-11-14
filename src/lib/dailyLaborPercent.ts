// The pure rules live in the shared folder so the edge functions use them too.
export {
  MAX_SHOWN_LABOR_PERCENT,
  computeDailyLaborPercent,
  projectDailySales,
  formatDailyLaborPercent,
  describeDailyLaborPercent,
  formatDollars,
  dayStringToDow,
} from '../../supabase/functions/_shared/labor/dailyLaborPercent.ts';
export type {
  DailyLaborPercent,
  DailyLaborPercentView,
  DailyLaborPercentInput,
} from '../../supabase/functions/_shared/labor/dailyLaborPercent.ts';
