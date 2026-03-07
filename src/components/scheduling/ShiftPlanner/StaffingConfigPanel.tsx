import { memo } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

export const StaffingConfigPanel = memo(function StaffingConfigPanel({
  settings,
  onSettingsChange,
  onSaveDefaults,
  isSaving,
}: Readonly<StaffingConfigPanelProps>) {
  return (
    <div className="flex flex-wrap items-end gap-4 px-4 py-3 border-b border-border/40 bg-muted/30">
      <div className="flex flex-col gap-1">
        <Label htmlFor="splh-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          SPLH Target ($)
        </Label>
        <Input
          id="splh-input"
          type="number"
          min={1}
          value={settings.target_splh}
          onChange={(e) => onSettingsChange({ target_splh: Number(e.target.value) || 1 })}
          className="h-8 w-20 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
          aria-label="Sales per labor hour target"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="labor-pct-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          Labor % Target
        </Label>
        <Input
          id="labor-pct-input"
          type="number"
          min={1}
          max={100}
          value={settings.target_labor_pct}
          onChange={(e) => onSettingsChange({ target_labor_pct: Number(e.target.value) || 1 })}
          className="h-8 w-20 text-[13px] bg-muted/30 border-border/40 rounded-lg focus-visible:ring-1 focus-visible:ring-border"
          aria-label="Target labor percentage"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="min-staff-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
          Min Staff
        </Label>
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
