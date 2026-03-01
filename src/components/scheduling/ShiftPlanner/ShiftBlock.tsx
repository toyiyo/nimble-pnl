import { memo } from 'react';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { Lock } from 'lucide-react';

import type { Shift } from '@/types/scheduling';

import { cn } from '@/lib/utils';

interface ShiftBlockProps {
  shift: Shift;
  onClick: (shift: Shift) => void;
}

// Position-based color mapping using semantic-safe colors
const POSITION_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  server: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-700 dark:text-blue-300',
  },
  cook: {
    bg: 'bg-orange-500/15',
    border: 'border-orange-500/30',
    text: 'text-orange-700 dark:text-orange-300',
  },
  bartender: {
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/30',
    text: 'text-purple-700 dark:text-purple-300',
  },
  host: {
    bg: 'bg-green-500/15',
    border: 'border-green-500/30',
    text: 'text-green-700 dark:text-green-300',
  },
  manager: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-700 dark:text-red-300',
  },
};

const DEFAULT_COLORS = {
  bg: 'bg-muted/50',
  border: 'border-border/40',
  text: 'text-foreground',
};

/**
 * Formats an ISO timestamp into a compact time string like "9a" or "3p".
 */
function formatCompactTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'p' : 'a';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * Compute the shift duration in hours (net of break).
 */
function durationHours(shift: Shift): string {
  const startMs = new Date(shift.start_time).getTime();
  const endMs = new Date(shift.end_time).getTime();
  const netMinutes = (endMs - startMs) / 60_000 - (shift.break_duration || 0);
  const hours = Math.round((netMinutes / 60) * 10) / 10;
  return `${hours}h`;
}

function getColors(position: string) {
  const key = position.toLowerCase();
  return POSITION_COLORS[key] ?? DEFAULT_COLORS;
}

export const ShiftBlock = memo(
  function ShiftBlock({ shift, onClick }: ShiftBlockProps) {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      isDragging,
    } = useDraggable({
      id: shift.id,
      data: { shift },
      disabled: shift.locked,
    });

    const style = transform
      ? { transform: CSS.Translate.toString(transform) }
      : undefined;

    const colors = getColors(shift.position);
    const timeRange = `${formatCompactTime(shift.start_time)}-${formatCompactTime(shift.end_time)}`;
    const duration = durationHours(shift);

    return (
      <button
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        type="button"
        onClick={() => onClick(shift)}
        aria-label={`${shift.position} shift ${timeRange}`}
        className={cn(
          'w-full text-left rounded-lg border px-2 py-1.5 transition-colors cursor-pointer',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          colors.bg,
          colors.border,
          colors.text,
          isDragging && 'opacity-40',
          shift.locked && 'opacity-60 cursor-default',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[12px] font-medium truncate">
            {timeRange}
          </span>
          {shift.locked && <Lock className="h-3 w-3 shrink-0 opacity-60" />}
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <span className="text-[11px] truncate opacity-80">
            {shift.position}
          </span>
          <span className="text-[11px] opacity-60">{duration}</span>
        </div>
      </button>
    );
  },
  (prev, next) =>
    prev.shift.id === next.shift.id &&
    prev.shift.updated_at === next.shift.updated_at,
);
