import { memo } from 'react';

import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

interface EmployeeChipProps {
  employeeName: string;
  shiftId: string;
  position: string;
  onRemove: (shiftId: string) => void;
}

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

function getColors(position: string) {
  const key = position.toLowerCase();
  return POSITION_COLORS[key] ?? DEFAULT_COLORS;
}

export const EmployeeChip = memo(
  function EmployeeChip({
    employeeName,
    shiftId,
    position,
    onRemove,
  }: EmployeeChipProps) {
    const colors = getColors(position);

    return (
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md border text-[12px] font-medium',
          colors.bg,
          colors.border,
          colors.text,
        )}
      >
        <span className="truncate">{employeeName}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(shiftId);
          }}
          aria-label={`Remove ${employeeName} from shift`}
          className="shrink-0 ml-0.5 rounded hover:bg-foreground/10 p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  },
  (prev, next) =>
    prev.shiftId === next.shiftId &&
    prev.employeeName === next.employeeName &&
    prev.onRemove === next.onRemove,
);
