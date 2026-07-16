import { memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Eye, EyeOff, MoreHorizontal, Pencil } from 'lucide-react';

import type { ShiftTemplate } from '@/types/scheduling';

interface TemplateRowHeaderProps {
  template: ShiftTemplate;
  onEdit: (template: ShiftTemplate) => void;
  onHide: (template: ShiftTemplate) => void;
  onRestore: (templateId: string) => void;
}

function formatCompactTemplateTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'p' : 'a';
  const hour12 = h % 12 || 12;
  if (m === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(m).padStart(2, '0')}${suffix}`;
}

export const TemplateRowHeader = memo(function TemplateRowHeader({
  template,
  onEdit,
  onHide,
  onRestore,
}: TemplateRowHeaderProps) {
  const isHidden = !template.is_active;

  return (
    <div className="flex items-center justify-between p-1 md:p-3 min-h-[48px] md:min-h-[64px]">
      {/* Desktop: full name + time + position */}
      <div className="hidden md:block min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="text-[14px] font-medium text-foreground truncate">
            {template.name}
          </div>
          {isHidden && (
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-dashed border-border rounded-md px-1.5 inline-flex items-center gap-1 shrink-0">
              <EyeOff className="h-3 w-3" aria-hidden="true" />
              Hidden
            </span>
          )}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {formatCompactTemplateTime(template.start_time)}-
          {formatCompactTemplateTime(template.end_time)}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {template.position}
        </div>
        {template.capacity > 1 && (
          <div className="text-[10px] font-medium text-amber-600">
            Need {template.capacity}
          </div>
        )}
      </div>
      {/* Mobile: abbreviated name + time only (56px column: badge text only, no icon) */}
      <div className="block md:hidden min-w-0 text-center w-full">
        <div className="text-[11px] font-medium text-foreground truncate">
          {template.name.length > 5 ? template.name.slice(0, 5) + '.' : template.name}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatCompactTemplateTime(template.start_time)}
        </div>
        {isHidden && (
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Hidden
          </div>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hidden md:inline-flex"
            aria-label={`Actions for ${template.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(template)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          {isHidden ? (
            <DropdownMenuItem onClick={() => onRestore(template.id)}>
              <Eye className="h-4 w-4 mr-2" /> Restore template
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onClick={() => onHide(template)}
              className="text-muted-foreground"
            >
              <EyeOff className="h-4 w-4 mr-2" /> Hide template
              <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                keeps shifts
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}, (prev, next) => {
  return (
    prev.template.id === next.template.id &&
    prev.template.updated_at === next.template.updated_at &&
    prev.template.is_active === next.template.is_active
  );
});
