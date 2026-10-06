import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { Layers, Plus } from 'lucide-react';

import type { SchedulePlanTemplate } from '@/types/scheduling';

import { formatHours, shiftHours } from '@/lib/weekTemplateDraft';
import { cn } from '@/lib/utils';

interface WeekTemplateListProps {
  templates: SchedulePlanTemplate[];
  /** Template id, 'new' for an unsaved draft, or null. */
  selectedId: string | null;
  newDraftName: string | null;
  isLoading: boolean;
  hasError: boolean;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  maxTemplates: number;
}

function totalHours(t: SchedulePlanTemplate): number {
  return t.shifts.reduce((sum, s) => sum + shiftHours(s), 0);
}

export function WeekTemplateList({
  templates,
  selectedId,
  newDraftName,
  isLoading,
  hasError,
  onRetry,
  onSelect,
  onNew,
  maxTemplates,
}: Readonly<WeekTemplateListProps>) {
  const atLimit = templates.length >= maxTemplates;

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="space-y-2" aria-label="Loading templates">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  } else if (hasError) {
    body = (
      <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/10 space-y-2">
        <p className="text-[13px] text-destructive">Could not load templates.</p>
        <Button type="button" variant="ghost" onClick={onRetry} className="h-8 px-2 text-[13px]">
          Retry
        </Button>
      </div>
    );
  } else if (templates.length === 0 && !newDraftName) {
    body = (
      <div className="flex flex-col items-center text-center gap-3 py-8">
        <div className="h-12 w-12 rounded-xl bg-muted/50 flex items-center justify-center">
          <Layers className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-[14px] font-medium text-foreground">Create your first week template</p>
          <p className="text-[13px] text-muted-foreground mt-0.5">Plan a Monday–Sunday week, then apply it to any week.</p>
        </div>
      </div>
    );
  } else {
    body = (
      <ul className="space-y-1">
        {newDraftName && (
          <li>
            <button
              type="button"
              aria-current={selectedId === 'new' ? 'true' : undefined}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                selectedId === 'new' ? 'bg-muted/50 border-border' : 'border-transparent hover:border-border/40',
              )}
              onClick={() => onSelect('new')}
            >
              <span className="block text-[14px] font-medium text-foreground truncate">{newDraftName}</span>
              <span className="block text-[12px] text-amber-700 dark:text-amber-400">Not saved yet</span>
            </button>
          </li>
        )}
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              aria-current={selectedId === t.id ? 'true' : undefined}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-lg border transition-colors',
                selectedId === t.id ? 'bg-muted/50 border-border' : 'border-transparent hover:border-border/40',
              )}
              onClick={() => onSelect(t.id)}
            >
              <span className="block text-[14px] font-medium text-foreground truncate">{t.name}</span>
              <span className="block text-[12px] text-muted-foreground tabular-nums">
                {t.shift_count} {t.shift_count === 1 ? 'shift' : 'shifts'} · {formatHours(totalHours(t))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <aside aria-label="Week templates" className="rounded-xl border border-border/40 bg-background p-3 space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">Week templates</h2>
        {!isLoading && !hasError && (
          <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted tabular-nums">
            {templates.length}/{maxTemplates}
          </span>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onNew}
        disabled={isLoading || atLimit || newDraftName !== null}
        className="w-full h-9 rounded-lg text-[13px] font-medium border-border/40"
      >
        <Plus className="h-4 w-4 mr-1.5" />
        New template
      </Button>
      {atLimit && (
        <p className="text-[11px] text-muted-foreground px-1">
          Maximum {maxTemplates} templates. Delete one to add another.
        </p>
      )}
      {body}
    </aside>
  );
}
