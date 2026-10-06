import { Calendar } from '@/components/ui/calendar';

import { AlertTriangle } from 'lucide-react';

import { getWeekEnd } from '@/hooks/useShiftPlanner';

import type { TemplateMergeMode } from '@/types/scheduling';
import { formatWeekRange } from '@/lib/schedulePlanTemplates';


interface TemplateApplyFieldsProps {
  selectedDate: Date | undefined;
  onSelectDate: (date: Date | undefined) => void;
  /** Monday of the selected week, or null. */
  targetMonday: Date | null;
  isPastWeek: boolean;
  mergeMode: TemplateMergeMode;
  onMergeModeChange: (mode: TemplateMergeMode) => void;
  /** Radio group name. Must be unique on the page. */
  radioName?: string;
}

const MODES: { value: TemplateMergeMode; title: string; hint: string }[] = [
  { value: 'replace', title: 'Replace existing', hint: 'Remove all unlocked shifts in the target week first' },
  { value: 'merge', title: 'Merge with existing', hint: 'Add template shifts alongside existing ones' },
];

/** Week picker and Replace/Merge choice. Shared by Copy Week and Week Templates. */
export function TemplateApplyFields({
  selectedDate,
  onSelectDate,
  targetMonday,
  isPastWeek,
  mergeMode,
  onMergeModeChange,
  radioName = 'mergeMode',
}: Readonly<TemplateApplyFieldsProps>) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-3">Apply to week</p>
        <div className="flex justify-center">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={onSelectDate}
            className="rounded-lg border border-border/40"
          />
        </div>
      </div>

      {targetMonday && (
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/40">
          <span className="text-[13px] text-muted-foreground">Target week</span>
          <span className="text-[13px] font-medium text-foreground">
            {formatWeekRange(targetMonday, getWeekEnd(targetMonday))}
          </span>
        </div>
      )}

      {isPastWeek && targetMonday && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-[12px] text-destructive">Cannot apply to a past week.</p>
        </div>
      )}

      <fieldset>
        <legend className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Mode</legend>
        <div className="space-y-2">
          {MODES.map((mode) => (
            <label
              key={mode.value}
              className="flex items-center gap-3 p-3 rounded-lg border border-border/40 cursor-pointer hover:border-border transition-colors"
            >
              <input
                type="radio"
                name={radioName}
                value={mode.value}
                checked={mergeMode === mode.value}
                onChange={() => onMergeModeChange(mode.value)}
                className="accent-foreground"
              />
              <div>
                <p className="text-[14px] font-medium text-foreground">{mode.title}</p>
                <p className="text-[12px] text-muted-foreground">{mode.hint}</p>
              </div>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
