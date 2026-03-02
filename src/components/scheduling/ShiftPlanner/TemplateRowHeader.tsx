import { memo } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import type { ShiftTemplate } from '@/types/scheduling';

interface TemplateRowHeaderProps {
  template: ShiftTemplate;
  onEdit: (template: ShiftTemplate) => void;
  onDelete: (templateId: string) => void;
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
  onDelete,
}: TemplateRowHeaderProps) {
  return (
    <div className="flex items-center justify-between p-3 min-h-[64px]">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-foreground truncate">
          {template.name}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {formatCompactTemplateTime(template.start_time)}-
          {formatCompactTemplateTime(template.end_time)}
        </div>
        <div className="text-[12px] text-muted-foreground">
          {template.position}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label={`Actions for ${template.name}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(template)}>
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onDelete(template.id)}
            className="text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}, (prev, next) => {
  return (
    prev.template.id === next.template.id &&
    prev.template.updated_at === next.template.updated_at
  );
});
