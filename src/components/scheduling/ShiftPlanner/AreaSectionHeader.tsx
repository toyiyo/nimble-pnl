import { ChevronDown, ChevronRight } from 'lucide-react';

interface AreaSectionHeaderProps {
  readonly area: string;
  readonly templateCount: number;
  readonly isCollapsed: boolean;
  readonly onToggle: () => void;
  readonly colSpan: number;
}

export function AreaSectionHeader({
  area,
  templateCount,
  isCollapsed,
  onToggle,
  colSpan,
}: AreaSectionHeaderProps) {
  return (
    <div
      className="col-span-full border-t border-border/40 bg-muted/50 cursor-pointer select-none"
      style={{ gridColumn: `1 / span ${colSpan}` }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
      aria-label={`${area} section, ${templateCount} templates`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {isCollapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-[13px] font-semibold text-foreground">{area}</span>
        <span className="text-[11px] text-muted-foreground">
          {templateCount} {templateCount === 1 ? 'template' : 'templates'}
        </span>
      </div>
    </div>
  );
}
