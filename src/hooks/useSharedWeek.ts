import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useSetSearchParams } from '@/hooks/useSearchParamState';
import { getMondayOfWeek } from '@/hooks/useShiftPlanner';
import { SCHEDULING_PARAMS } from '@/lib/schedulingUrlParams';
import { formatLocalDate } from '@/lib/shiftInterval';

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
  const [searchParams] = useSearchParams();
  const setParams = useSetSearchParams();
  const rawWeek = searchParams.get(SCHEDULING_PARAMS.week);

  const weekStart = useMemo(() => parseWeekParam(rawWeek), [rawWeek]);

  const setWeekStart = useCallback(
    (date: Date) => {
      const monday = getMondayOfWeek(date);
      setParams({ [SCHEDULING_PARAMS.week]: formatLocalDate(monday) }, { history: 'replace' });
    },
    [setParams],
  );

  return { weekStart, setWeekStart };
}
