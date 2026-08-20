import { useEffect, useState } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { cn } from '@/lib/utils';
import type { Period } from '@/components/PeriodSelector';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { customPeriodLabel } from '@/lib/periodUrlState';

interface TimelineBrushProps {
  /** The page-level period. The brush both reads and writes it. */
  selectedPeriod: Period;
  onPeriodChange: (period: Period) => void;
  /** Earliest known transaction date, when known. Caps the domain start. */
  earliestTransaction?: Date | null;
  className?: string;
}

function domainFor(earliestTransaction: Date | null | undefined, selectedPeriodEnd: Date): { start: Date; end: Date } {
  const today = new Date();
  const defaultEnd = endOfDay(today);
  // A custom period can end in the future (the date picker allows it).
  // Extend the domain to cover it, or the thumb clamps to today and a
  // commit silently overwrites the period with an earlier end date.
  const end = selectedPeriodEnd > defaultEnd ? endOfDay(selectedPeriodEnd) : defaultEnd;
  const defaultStart = startOfMonth(subMonths(today, 23));
  const start = earliestTransaction && earliestTransaction > defaultStart
    ? startOfDay(earliestTransaction)
    : defaultStart;
  return { start, end };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const THUMB_CLASS =
  'relative block h-6 w-6 rounded-full border-2 border-foreground bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50';

/**
 * The date above a thumb. Visible while a pointer drags the slider, and on
 * keyboard focus, so an arrow-key user sees the date too.
 */
function ThumbDateBubble({ label, visible }: { label: string; visible: boolean }) {
  return (
    <span
      data-testid="brush-thumb-date"
      className={cn(
        'pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-border/40 bg-background px-2 py-1 text-[11px] font-medium text-foreground shadow-sm transition-opacity',
        visible ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-100',
      )}
    >
      {label}
    </span>
  );
}

/**
 * Two-thumb range slider over a 24-month window of dates. It reads and
 * writes the page-level `selectedPeriod` state, the same state the preset
 * tabs write. Dragging (or arrow-keying) a thumb to commit calls
 * `onPeriodChange` with `type: 'custom'`.
 */
export function TimelineBrush({
  selectedPeriod,
  onPeriodChange,
  earliestTransaction = null,
  className,
}: TimelineBrushProps) {
  const isSmUp = useMediaQuery('(min-width: 640px)');
  const isLgUp = useMediaQuery('(min-width: 1024px)');
  const step = isSmUp ? 1 : 7;

  const { start: domainStart, end: domainEnd } = domainFor(earliestTransaction, selectedPeriod.to);
  const totalDays = Math.max(differenceInCalendarDays(domainEnd, domainStart), 1);

  const dateToIndex = (date: Date) => clamp(differenceInCalendarDays(date, domainStart), 0, totalDays);
  const indexToRange = (startIndex: number, endIndex: number): { from: Date; to: Date } => ({
    from: startOfDay(addDays(domainStart, startIndex)),
    to: endOfDay(addDays(domainStart, endIndex)),
  });

  const [value, setValue] = useState<[number, number]>(() => [
    dateToIndex(selectedPeriod.from),
    dateToIndex(selectedPeriod.to),
  ]);
  // True while a pointer drags a thumb. Shows the date bubbles.
  const [isDragging, setIsDragging] = useState(false);

  const thumbDates: [string, string] = [
    format(addDays(domainStart, value[0]), 'MMM d, yyyy'),
    format(addDays(domainStart, value[1]), 'MMM d, yyyy'),
  ];

  // External period changes (preset tabs, the date picker) move the thumbs.
  useEffect(() => {
    setValue([dateToIndex(selectedPeriod.from), dateToIndex(selectedPeriod.to)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriod.from.getTime(), selectedPeriod.to.getTime(), domainStart.getTime()]);

  const handleCommit = (next: number[]) => {
    setIsDragging(false);
    const [startIndex, endIndex] = next as [number, number];
    const { from, to } = indexToRange(startIndex, endIndex);
    onPeriodChange({
      type: 'custom',
      from,
      to,
      label: customPeriodLabel(from, to),
    });
  };

  const tickEvery = isLgUp ? 1 : 3;
  const ticks: { key: string; label: string; percent: number }[] = [];
  let monthIndex = 0;
  for (let d = startOfMonth(domainStart); d <= domainEnd; d = startOfMonth(addDays(d, 32))) {
    if (d >= domainStart && monthIndex % tickEvery === 0) {
      const dayOffset = differenceInCalendarDays(d, domainStart);
      ticks.push({
        key: d.toISOString(),
        label: format(d, 'MMM yyyy'),
        percent: (dayOffset / totalDays) * 100,
      });
    }
    monthIndex += 1;
  }

  return (
    <div className={cn('space-y-2', className)} data-timeline-step={String(step)}>
      <SliderPrimitive.Root
        className="relative flex w-full touch-none select-none items-center py-3"
        min={0}
        max={totalDays}
        step={step}
        value={value}
        minStepsBetweenThumbs={1}
        onValueChange={(next) => setValue(next as [number, number])}
        onValueCommit={handleCommit}
        onPointerDown={() => setIsDragging(true)}
        onPointerUp={() => setIsDragging(false)}
        onPointerCancel={() => setIsDragging(false)}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute h-full bg-foreground/70" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Start date"
          aria-valuetext={thumbDates[0]}
          className={cn(THUMB_CLASS, 'group')}
        >
          <ThumbDateBubble label={thumbDates[0]} visible={isDragging} />
        </SliderPrimitive.Thumb>
        <SliderPrimitive.Thumb
          aria-label="End date"
          aria-valuetext={thumbDates[1]}
          className={cn(THUMB_CLASS, 'group')}
        >
          <ThumbDateBubble label={thumbDates[1]} visible={isDragging} />
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Root>
      <div className="relative h-4 w-full">
        {ticks.map((tick) => (
          <span
            key={tick.key}
            data-testid="timeline-brush-tick"
            className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground"
            style={{ left: `${tick.percent}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  );
}
