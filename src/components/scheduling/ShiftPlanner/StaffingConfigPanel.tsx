import { memo, useCallback, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

import { HelpCircle, Plus, X } from 'lucide-react';

import type { MinCrew } from '@/types/scheduling';

interface StaffingConfigPanelProps {
  settings: {
    target_splh: number;
    target_labor_pct: number;
    min_staff: number;
    min_crew: MinCrew | null;
    open_shifts_enabled?: boolean;
    require_shift_claim_approval?: boolean;
  };
  onSettingsChange: (updates: Record<string, unknown>) => void;
  onImmediateSettingsChange?: (updates: Record<string, unknown>) => void;
  onSaveDefaults: () => void;
  isSaving: boolean;
  employeePositions: string[];
  actualSplh: number | null;
  lookbackWeeks: number;
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
  onImmediateSettingsChange,
  onSaveDefaults,
  isSaving,
  employeePositions,
  actualSplh,
  lookbackWeeks,
}: Readonly<StaffingConfigPanelProps>) {
  const [newPosition, setNewPosition] = useState('');

  const minCrew = useMemo(() => settings.min_crew ?? {}, [settings.min_crew]);
  const crewPositions = Object.keys(minCrew);
  const hasMinCrew = crewPositions.length > 0;

  // Positions from employees that aren't already in min_crew
  const availablePositions = useMemo(
    () => employeePositions.filter((p) => !(p in minCrew)),
    [employeePositions, minCrew],
  );

  const totalCrewFloor = useMemo(
    () => hasMinCrew ? Object.values(minCrew).reduce((sum, v) => sum + v, 0) : settings.min_staff,
    [hasMinCrew, minCrew, settings.min_staff],
  );

  const handleCrewChange = useCallback((position: string, value: number) => {
    const updated = { ...minCrew, [position]: Math.max(0, value) };
    onSettingsChange({ min_crew: updated });
  }, [minCrew, onSettingsChange]);

  const handleRemovePosition = useCallback((position: string) => {
    const updated = { ...minCrew };
    delete updated[position];
    onSettingsChange({ min_crew: Object.keys(updated).length > 0 ? updated : null });
  }, [minCrew, onSettingsChange]);

  const handleAddPosition = useCallback((position: string) => {
    if (!position.trim()) return;
    const updated = { ...minCrew, [position.trim()]: 1 };
    onSettingsChange({ min_crew: updated });
    setNewPosition('');
  }, [minCrew, onSettingsChange]);

  return (
    <div className="px-4 py-3 border-b border-border/40 bg-muted/30 space-y-3">
      {/* Top row: SPLH + Labor % */}
      <div className="flex flex-wrap items-end gap-4">
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
          {actualSplh !== null && (
            <span className="text-[11px] text-muted-foreground/80">
              Your actual: ${actualSplh}/hr{' '}
              <span className="text-muted-foreground/50">(last {lookbackWeeks} wks)</span>
            </span>
          )}
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

        {/* Fallback min staff (shown only when no position-based crew) */}
        {!hasMinCrew && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Label htmlFor="min-staff-input" className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
                Min Staff
              </Label>
              <HelpTip text="Minimum number of staff scheduled per hour. Set up minimum crew below to use position-based staffing." />
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
        )}

        <button
          onClick={onSaveDefaults}
          disabled={isSaving}
          className="h-8 px-3 rounded-lg text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          aria-label="Save staffing settings as default"
        >
          {isSaving ? 'Saving...' : 'Save as Default'}
        </button>
      </div>

      {/* Minimum crew section */}
      <div className="rounded-lg border border-border/40 bg-background overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border/20 bg-muted/20">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-muted-foreground uppercase tracking-wider">
              Minimum Crew
            </span>
            <HelpTip text="Set the minimum number of each position needed to operate. The total becomes your staffing floor — the system won't recommend fewer staff than your minimum crew." />
          </div>
          {hasMinCrew && (
            <span className="text-[11px] text-muted-foreground">
              Floor: {totalCrewFloor} staff/hr
            </span>
          )}
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {crewPositions.length > 0 ? (
            crewPositions.map((position) => (
              <div key={position} className="flex items-center gap-2">
                <span className="text-[13px] text-foreground min-w-[100px]">{position}</span>
                <Input
                  type="number"
                  min={0}
                  value={minCrew[position]}
                  onChange={(e) => handleCrewChange(position, Number(e.target.value) || 0)}
                  className="h-7 w-14 text-[12px] bg-muted/30 border-border/40 rounded-md focus-visible:ring-1 focus-visible:ring-border"
                  aria-label={`Minimum ${position} per hour`}
                />
                <button
                  onClick={() => handleRemovePosition(position)}
                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-destructive transition-colors"
                  aria-label={`Remove ${position} from minimum crew`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))
          ) : (
            <p className="text-[12px] text-muted-foreground/60 py-1">
              No positions set. Add positions to define your minimum crew.
            </p>
          )}

          {/* Add position */}
          <div className="flex items-center gap-1.5 pt-1">
            {availablePositions.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {availablePositions.map((pos) => (
                  <button
                    key={pos}
                    onClick={() => handleAddPosition(pos)}
                    className="h-6 px-2 rounded-md text-[11px] font-medium bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground border border-border/40 transition-colors flex items-center gap-1"
                    aria-label={`Add ${pos} to minimum crew`}
                  >
                    <Plus className="h-2.5 w-2.5" />
                    {pos}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-1">
              <Input
                type="text"
                placeholder="Custom position..."
                value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddPosition(newPosition);
                  }
                }}
                className="h-6 w-32 text-[11px] bg-muted/30 border-border/40 rounded-md focus-visible:ring-1 focus-visible:ring-border"
                aria-label="Custom position name"
              />
              <button
                onClick={() => handleAddPosition(newPosition)}
                disabled={!newPosition.trim()}
                className="h-6 px-1.5 rounded-md text-muted-foreground/60 hover:text-foreground transition-colors disabled:opacity-30"
                aria-label="Add custom position"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Open Shift Claiming */}
      <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
          <h3 className="text-[13px] font-semibold text-foreground">Open Shift Claiming</h3>
        </div>
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-foreground">
                Allow employees to claim open shifts
              </div>
              <p className="text-[13px] text-muted-foreground mt-0.5">
                When enabled, employees can see and claim unfilled shifts after you publish the schedule.
              </p>
            </div>
            <Switch
              checked={!!settings.open_shifts_enabled}
              onCheckedChange={(checked) => {
                onSettingsChange({ open_shifts_enabled: checked });
                onImmediateSettingsChange?.({ open_shifts_enabled: checked });
              }}
              disabled={isSaving}
              className="data-[state=checked]:bg-foreground"
              aria-label="Allow employees to claim open shifts"
            />
          </div>
          {settings.open_shifts_enabled && (
            <div className="flex items-center justify-between gap-4 pl-4 border-l-2 border-border/40">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-foreground">
                  Require manager approval
                </div>
                <p className="text-[13px] text-muted-foreground mt-0.5">
                  When off, employees are instantly assigned. When on, claims go to your approval queue.
                </p>
              </div>
              <Switch
                checked={!!settings.require_shift_claim_approval}
                onCheckedChange={(checked) => {
                  onSettingsChange({ require_shift_claim_approval: checked });
                  onImmediateSettingsChange?.({ require_shift_claim_approval: checked });
                }}
                disabled={isSaving}
                className="data-[state=checked]:bg-foreground"
                aria-label="Require manager approval for shift claims"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
