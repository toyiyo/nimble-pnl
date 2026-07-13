export type SplhCellState = 'lean' | 'balanced' | 'slack' | 'no-labor' | 'closed';

export interface HourContribution {
  localDate: string; // YYYY-MM-DD in tz
  dow: number;       // 0=Sun..6=Sat (UTC-derived from localDate)
  hour: number;      // 0..23 local
  hours: number;
}

export interface SplhGridCell {
  dow: number;
  hour: number;
  totalSales: number;
  totalHours: number;
  splh: number | null;
  state: SplhCellState;
}

export interface SplhPoint {
  bucketStart: string; // local YYYY-MM-DD (Monday for week)
  label: string;
  totalSales: number;
  totalHours: number;
  splh: number | null;
}

export interface SplhSummary {
  actualSplh: number | null;
  target: number;
  laborPct: number | null;
  verdict: string;
  verdictTone: 'lean' | 'balanced' | 'slack' | 'none';
  hireHours: { dow: number; hour: number }[];
  trimHours: { dow: number; hour: number }[];
}

export interface SplhSaleRow {
  sale_date: string;
  sale_time: string | null;
  sold_at?: string | null;
  total_price: number;
}

/** ±band around target counts as "balanced". */
export const BALANCED_BAND = 0.15;

const _fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = _fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    _fmtCache.set(tz, f);
  }
  return f;
}

export function validateTimeZone(tz: string | undefined | null): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}
