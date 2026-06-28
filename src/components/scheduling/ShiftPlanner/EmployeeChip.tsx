import { memo } from 'react';

import { X } from 'lucide-react';

import { cn } from '@/lib/utils';

import type { Shift } from '@/types/scheduling';

interface EmployeeChipProps {
  employeeName: string;
  shiftId: string;
  position: string;
  source?: Shift['source'];
  /** Employee's home area. */
  homeArea?: string | null;
  /** The area of the cell this chip renders in (template area). */
  cellArea?: string | null;
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
    source,
    homeArea,
    cellArea,
    onRemove,
  }: EmployeeChipProps) {
    const colors = getColors(position);
    const isCovering = !!homeArea && !!cellArea && homeArea !== cellArea;

    return (
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded-md border text-[12px] font-medium',
          colors.bg,
          colors.border,
          colors.text,
          isCovering && 'border-dashed',
        )}
      >
        {source === 'ai' && (
          <span className="text-violet-400 text-[10px] shrink-0" aria-label="AI generated">✦</span>
        )}
        {isCovering && (
          <span
            className="shrink-0 truncate max-w-[72px] text-[10px] px-1 rounded bg-muted/50 text-muted-foreground"
            title={`Covering from ${homeArea}`}
          >
            {homeArea}
          </span>
        )}
        <span className="truncate">{employeeName}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(shiftId);
          }}
          aria-label={isCovering
            ? `Remove ${employeeName} from shift (covering from ${homeArea})`
            : `Remove ${employeeName} from shift`}
          className="shrink-0 ml-0.5 rounded hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current p-0.5"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  },
  (prev, next) =>
    prev.shiftId === next.shiftId &&
    prev.employeeName === next.employeeName &&
    prev.position === next.position &&
    prev.source === next.source &&
    prev.homeArea === next.homeArea &&
    prev.cellArea === next.cellArea &&
    prev.onRemove === next.onRemove,
);
