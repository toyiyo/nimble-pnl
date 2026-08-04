import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AlertTriangle } from 'lucide-react';
import type { RoleAllocationMode, RoleAllocationRule } from '@/utils/tipPooling';

const DEFAULT_PERCENTAGE = 10;

type ModeValue = 'hours' | RoleAllocationMode;

interface RoleAllocationSectionProps {
  readonly roles: string[];
  readonly rules: Record<string, RoleAllocationRule>;
  readonly onChange: (rules: Record<string, RoleAllocationRule>) => void;
}

const MODE_LABELS: Record<ModeValue, { label: string; description: string }> = {
  hours: { label: 'By hours', description: 'by hours' },
  at_least: { label: 'At least', description: 'at least a set percentage' },
  exactly: { label: 'Exactly', description: 'exactly a set percentage' },
};

/**
 * Per-role allocation rules for the Full Pool model.
 *
 * Fully controlled: the dialog owns the rule map and auto-saves it, so this
 * component holds no state of its own. Rules are per person — two people in a
 * 10% role commit 20% of the pool — so the footer never reports a pool fraction.
 */
export function RoleAllocationSection({ roles, rules, onChange }: RoleAllocationSectionProps) {
  // Role names are free text ("Assistant Manager", "Bar-back"), so they cannot be
  // interpolated into a DOM id. Index off a generated base instead, which is both
  // valid and unique even when two roles differ only by punctuation.
  const idBase = useId();

  const handleModeChange = (role: string, next: string) => {
    if (!next || next === 'hours') {
      const { [role]: _removed, ...rest } = rules;
      onChange(rest);
      return;
    }
    onChange({
      ...rules,
      [role]: {
        mode: next as RoleAllocationMode,
        percentage: rules[role]?.percentage ?? DEFAULT_PERCENTAGE,
      },
    });
  };

  const handlePercentageChange = (role: string, raw: string) => {
    const existing = rules[role];
    if (!existing) return;
    const parsed = Number.parseFloat(raw);
    const percentage = Number.isNaN(parsed) ? 0 : Math.min(100, Math.max(0, parsed));
    onChange({ ...rules, [role]: { ...existing, percentage } });
  };

  const configured = roles.filter(role => rules[role]);
  const configuredTotal = configured.reduce((sum, role) => sum + rules[role].percentage, 0);
  const isOver = configuredTotal > 100;

  return (
    <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
        <h3 className="text-[13px] font-semibold text-foreground">Role Allocation</h3>
        <p className="text-[12px] text-muted-foreground mt-0.5">
          Guarantee a role a minimum share, or pin it to a fixed share. Applied per person on the
          days they worked.
        </p>
      </div>
      <div className="p-4 space-y-3">
        {roles.map((role, index) => {
          const rule = rules[role];
          const value: ModeValue = rule?.mode ?? 'hours';
          const percentageInputId = `${idBase}-role-pct-${index}`;

          return (
            <div key={role} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-[14px] text-foreground truncate">{role}</span>
              <ToggleGroup
                type="single"
                value={value}
                onValueChange={next => handleModeChange(role, next)}
                aria-label={`${role} allocation mode`}
                size="sm"
                variant="outline"
                className="justify-start"
              >
                {(['hours', 'at_least', 'exactly'] as ModeValue[]).map(mode => (
                  <ToggleGroupItem
                    key={mode}
                    value={mode}
                    aria-label={`${role}: ${MODE_LABELS[mode].description}`}
                    className="h-9 px-3 rounded-lg text-[13px] font-medium"
                  >
                    {MODE_LABELS[mode].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {rule ? (
                <div className="flex items-center gap-1.5">
                  <Label htmlFor={percentageInputId} className="sr-only">
                    {`${role} percentage`}
                  </Label>
                  <Input
                    id={percentageInputId}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={rule.percentage}
                    onChange={e => handlePercentageChange(role, e.target.value)}
                    className="w-20 h-9 text-[14px] bg-muted/30 border-border/40 rounded-lg"
                  />
                  <span className="text-[13px] text-muted-foreground">%</span>
                </div>
              ) : (
                <span className="text-[13px] text-muted-foreground" aria-hidden="true">
                  —
                </span>
              )}
            </div>
          );
        })}

        {configured.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className={
              isOver
                ? 'flex items-center gap-2 p-2.5 rounded-lg bg-warning/10 border border-warning/20'
                : 'pt-1'
            }
          >
            {isOver && <AlertTriangle className="h-4 w-4 text-warning flex-shrink-0" />}
            <span className={isOver ? 'text-[13px] text-warning' : 'text-[13px] text-muted-foreground'}>
              {isOver
                ? "Over 100% — guarantees will be scaled down proportionally on days they don't fit."
                : `${configured.map(role => `${rules[role].percentage}%`).join(' + ')} per person on these roles`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
