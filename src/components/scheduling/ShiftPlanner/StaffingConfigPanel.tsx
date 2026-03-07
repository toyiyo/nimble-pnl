import { memo } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { HelpCircle } from 'lucide-react';

interface StaffingConfigPanelProps {
  settings: {
    target_splh: number;
    target_labor_pct: number;
    min_staff: number;
  };
  onSettingsChange: (updates: Partial<StaffingConfigPanelProps['settings']>) => void;
  onSaveDefaults: () => void;
  isSaving: boolean;
}

function HelpTip({ text }: Readonly<{ text: string }>) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <HelpCircle className="h-3 w-3 text-muted-foreground/60 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-[12px]">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export const StaffingConfigPanel = memo(function StaffingConfigPanel({
  settings,
  onSettingsChange,
  onSaveDefaults,
  isSaving,
}: Readonly<StaffingConfigPanelProps>) {
  return (
    <div className="flex flex-wrap items-end gap-4 px-4 py-3 border-b border-border/40 bg-muted/30">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Label htmlFor="splh-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Sales per Labor Hour
          </Label>
          <HelpTip text="Target revenue generated per staff hour. Higher values mean fewer staff scheduled per hour." />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[13px] text-muted-foreground">$</span>
          <Input
            id="splh-input"
            type="number"
            min={1}
            value={settings.target_splh}
            onChange={(e) => onSettingsChange({ target_splh: Number(e.target.value) || 1 })}
            className="h-8 w-20 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            aria-label="Sales per labor hour target in dollars"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Label htmlFor="labor-pct-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Labor Cost Target
          </Label>
          <HelpTip text="Maximum labor cost as a percentage of sales. Hours that exceed this are flagged in amber." />
        </div>
        <div className="flex items-center gap-1">
          <Input
            id="labor-pct-input"
            type="number"
            min={1}
            max={100}
            value={settings.target_labor_pct}
            onChange={(e) => onSettingsChange({ target_labor_pct: Number(e.target.value) || 1 })}
            className="h-8 w-20 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
            aria-label="Target labor cost percentage"
          />
          <span className="text-[13px] text-muted-foreground">%</span>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <Label htmlFor="min-staff-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
            Min Staff
          </Label>
          <HelpTip text="Minimum number of staff scheduled per hour, even during slow periods." />
        </div>
        <Input
          id="min-staff-input"
          type="number"
          min={1}
          value={settings.min_staff}
          onChange={(e) => onSettingsChange({ min_staff: Number(e.target.value) || 1 })}
          className="h-8 w-16 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
          aria-label="Minimum staff per hour"
        />
      </div>
      <button
        onClick={onSaveDefaults}
        disabled={isSaving}
        className="h-8 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        aria-label="Save staffing settings as default"
      >
        {isSaving ? 'Saving...' : 'Save as Default'}
      </button>
    </div>
  );
});
