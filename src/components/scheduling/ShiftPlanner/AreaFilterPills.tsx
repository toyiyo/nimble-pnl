import { cn } from '@/lib/utils';
import { UNASSIGNED } from '@/lib/templateAreaGrouping';

interface AreaFilterPillsProps {
  readonly areas: string[];
  readonly hasUnassigned: boolean;
  readonly selectedArea: string | null;
  readonly onSelect: (area: string | null) => void;
}

export function AreaFilterPills({
  areas,
  hasUnassigned,
  selectedArea,
  onSelect,
}: AreaFilterPillsProps) {
  if (areas.length === 0 && !hasUnassigned) return null;

  const pills = [
    { label: 'All', value: null as string | null },
    ...areas.map((a) => ({ label: a, value: a })),
    ...(hasUnassigned ? [{ label: UNASSIGNED, value: UNASSIGNED }] : []),
  ];

  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        Area
      </span>
      {pills.map((pill) => (
        <button
          key={pill.label}
          type="button"
          onClick={() => onSelect(pill.value)}
          className={cn(
            'px-3 py-1 rounded-lg text-[12px] font-medium transition-colors',
            selectedArea === pill.value
              ? 'bg-foreground text-background'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          {pill.label}
        </button>
      ))}
    </div>
  );
}
