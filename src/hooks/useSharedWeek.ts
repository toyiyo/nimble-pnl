import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { getMondayOfWeek } from '@/hooks/useShiftPlanner';

const WEEK_PARAM = 'week';

function formatIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseWeekParam(value: string | null): Date {
  if (!value) return getMondayOfWeek(new Date());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return getMondayOfWeek(new Date());
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return getMondayOfWeek(new Date());
  return getMondayOfWeek(parsed);
}

export interface UseSharedWeekReturn {
  weekStart: Date;
  setWeekStart: (date: Date) => void;
}

export function useSharedWeek(): UseSharedWeekReturn {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawWeek = searchParams.get(WEEK_PARAM);

  const weekStart = useMemo(() => parseWeekParam(rawWeek), [rawWeek]);

  const setWeekStart = useCallback(
    (date: Date) => {
      const monday = getMondayOfWeek(date);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(WEEK_PARAM, formatIsoDate(monday));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return { weekStart, setWeekStart };
}
