import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useCreateComplianceRule, useUpdateComplianceRule } from '@/hooks/useCompliance';
import { 
  ComplianceRule, 
  ComplianceRuleType,
  MinorRestrictionsConfig,
  ClopeningConfig,
  RestPeriodConfig,
  ShiftLengthConfig,
  OvertimeConfig,
} from '@/types/compliance';

interface ComplianceRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule?: ComplianceRule;
  restaurantId: string;
}

const RULE_TYPES: { value: ComplianceRuleType; label: string }[] = [
  { value: 'minor_restrictions', label: 'Minor Labor Restrictions' },
  { value: 'clopening', label: 'Clopening Prevention' },
  { value: 'rest_period', label: 'Rest Period Requirements' },
  { value: 'shift_length', label: 'Shift Length Limits' },
  { value: 'overtime', label: 'Overtime Regulations' },
];

export const ComplianceRuleDialog = ({ open, onOpenChange, rule, restaurantId }: ComplianceRuleDialogProps) => {
  const [ruleType, setRuleType] = useState<ComplianceRuleType>('shift_length');
  const [enabled, setEnabled] = useState(true);
  
  // Minor restrictions fields
  const [minorMaxHoursPerDay, setMinorMaxHoursPerDay] = useState('8');
  const [minorMaxHoursPerWeek, setMinorMaxHoursPerWeek] = useState('40');
  const [minorEarliestStart, setMinorEarliestStart] = useState('06:00');
  const [minorLatestEnd, setMinorLatestEnd] = useState('22:00');
  
  // Clopening/Rest period fields
  const [minHoursBetweenShifts, setMinHoursBetweenShifts] = useState('11');
  const [allowOverride, setAllowOverride] = useState(false);
  
  // Shift length fields
  const [minShiftHours, setMinShiftHours] = useState('2');
  const [maxShiftHours, setMaxShiftHours] = useState('12');
  const [maxConsecutiveDays, setMaxConsecutiveDays] = useState('6');
  
  // Overtime fields
  const [weeklyThreshold, setWeeklyThreshold] = useState('40');
  const [dailyThreshold, setDailyThreshold] = useState('');
  const [warnOnly, setWarnOnly] = useState(true);

  const createRule = useCreateComplianceRule();
  const updateRule = useUpdateComplianceRule();

  useEffect(() => {
    if (rule) {
      setRuleType(rule.rule_type);
      setEnabled(rule.enabled);
      
      const config = rule.rule_config as Record<string, unknown>;
      
      switch (rule.rule_type) {
        case 'minor_restrictions': {
          const minorConfig = config as MinorRestrictionsConfig;
          setMinorMaxHoursPerDay(minorConfig.max_hours_per_day?.toString() || '8');
          setMinorMaxHoursPerWeek(minorConfig.max_hours_per_week?.toString() || '40');
          setMinorEarliestStart(minorConfig.earliest_start_time || '06:00');
          setMinorLatestEnd(minorConfig.latest_end_time || '22:00');
          break;
        }
        case 'clopening':
        case 'rest_period': {
          const restConfig = config as ClopeningConfig | RestPeriodConfig;
          setMinHoursBetweenShifts(restConfig.min_hours_between_shifts?.toString() || '11');
          setAllowOverride(restConfig.allow_override || false);
          break;
        }
        case 'shift_length': {
          const shiftConfig = config as ShiftLengthConfig;
          setMinShiftHours(shiftConfig.min_hours?.toString() || '2');
          setMaxShiftHours(shiftConfig.max_hours?.toString() || '12');
          setMaxConsecutiveDays(shiftConfig.max_consecutive_days?.toString() || '6');
          break;
        }
        case 'overtime': {
          const otConfig = config as OvertimeConfig;
          setWeeklyThreshold(otConfig.weekly_threshold?.toString() || '40');
          setDailyThreshold(otConfig.daily_threshold?.toString() || '');
          setWarnOnly(otConfig.warn_only !== false);
          break;
        }
      }
    } else {
      resetForm();
    }
  }, [rule, open]);

  const resetForm = () => {
    setRuleType('shift_length');
    setEnabled(true);
    setMinorMaxHoursPerDay('8');
    setMinorMaxHoursPerWeek('40');
    setMinorEarliestStart('06:00');
    setMinorLatestEnd('22:00');
    setMinHoursBetweenShifts('11');
    setAllowOverride(false);
    setMinShiftHours('2');
    setMaxShiftHours('12');
    setMaxConsecutiveDays('6');
    setWeeklyThreshold('40');
    setDailyThreshold('');
    setWarnOnly(true);
  };

  const buildRuleConfig = () => {
    switch (ruleType) {
      case 'minor_restrictions': {
        const config: MinorRestrictionsConfig = {
          max_hours_per_day: parseFloat(minorMaxHoursPerDay),
          max_hours_per_week: parseFloat(minorMaxHoursPerWeek),
          earliest_start_time: minorEarliestStart,
          latest_end_time: minorLatestEnd,
        };
        return config;
      }
      case 'clopening':
      case 'rest_period': {
        const config: ClopeningConfig | RestPeriodConfig = {
          min_hours_between_shifts: parseFloat(minHoursBetweenShifts),
          allow_override: allowOverride,
        };
        return config;
      }
      case 'shift_length': {
        const config: ShiftLengthConfig = {
          min_hours: parseFloat(minShiftHours),
          max_hours: parseFloat(maxShiftHours),
          max_consecutive_days: maxConsecutiveDays ? parseInt(maxConsecutiveDays) : undefined,
        };
        return config;
      }
      case 'overtime': {
        const config: OvertimeConfig = {
          weekly_threshold: parseFloat(weeklyThreshold),
          daily_threshold: dailyThreshold ? parseFloat(dailyThreshold) : undefined,
          warn_only: warnOnly,
        };
        return config;
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const ruleConfig = buildRuleConfig();

    if (rule) {
      updateRule.mutate(
        {
          id: rule.id,
          rule_type: ruleType,
          rule_config: ruleConfig,
          enabled,
        },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    } else {
      createRule.mutate(
        {
          restaurant_id: restaurantId,
          rule_type: ruleType,
          rule_config: ruleConfig,
          enabled,
        },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        }
      );
    }
  };

  const renderConfigFields = () => {
    switch (ruleType) {
      case 'minor_restrictions':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minorMaxDay">Max Hours per Day</Label>
                <Input
                  id="minorMaxDay"
                  type="number"
                  min="1"
                  max="12"
                  step="0.5"
                  value={minorMaxHoursPerDay}
                  onChange={(e) => setMinorMaxHoursPerDay(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minorMaxWeek">Max Hours per Week</Label>
                <Input
                  id="minorMaxWeek"
                  type="number"
                  min="1"
                  max="40"
                  value={minorMaxHoursPerWeek}
                  onChange={(e) => setMinorMaxHoursPerWeek(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="earliestStart">Earliest Start Time</Label>
                <Input
                  id="earliestStart"
                  type="time"
                  value={minorEarliestStart}
                  onChange={(e) => setMinorEarliestStart(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="latestEnd">Latest End Time</Label>
                <Input
                  id="latestEnd"
                  type="time"
                  value={minorLatestEnd}
                  onChange={(e) => setMinorLatestEnd(e.target.value)}
                />
              </div>
            </div>
          </div>
        );

      case 'clopening':
      case 'rest_period':
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="minHours">Minimum Hours Between Shifts</Label>
              <Input
                id="minHours"
                type="number"
                min="8"
                max="24"
                value={minHoursBetweenShifts}
                onChange={(e) => setMinHoursBetweenShifts(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {ruleType === 'clopening' 
                  ? 'Hours required between closing and opening shifts'
                  : 'Minimum rest period between any two shifts'}
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="allowOverride"
                checked={allowOverride}
                onCheckedChange={setAllowOverride}
              />
              <Label htmlFor="allowOverride">Allow managers to override this rule</Label>
            </div>
          </div>
        );

      case 'shift_length':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minShift">Minimum Shift Hours</Label>
                <Input
                  id="minShift"
                  type="number"
                  min="1"
                  max="8"
                  step="0.5"
                  value={minShiftHours}
                  onChange={(e) => setMinShiftHours(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxShift">Maximum Shift Hours</Label>
                <Input
                  id="maxShift"
                  type="number"
                  min="4"
                  max="16"
                  step="0.5"
                  value={maxShiftHours}
                  onChange={(e) => setMaxShiftHours(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="maxDays">Max Consecutive Days (optional)</Label>
              <Input
                id="maxDays"
                type="number"
                min="1"
                max="14"
                value={maxConsecutiveDays}
                onChange={(e) => setMaxConsecutiveDays(e.target.value)}
                placeholder="e.g., 6"
              />
            </div>
          </div>
        );

      case 'overtime':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="weeklyOT">Weekly Threshold (hours)</Label>
                <Input
                  id="weeklyOT"
                  type="number"
                  min="35"
                  max="60"
                  value={weeklyThreshold}
                  onChange={(e) => setWeeklyThreshold(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dailyOT">Daily Threshold (optional)</Label>
                <Input
                  id="dailyOT"
                  type="number"
                  min="8"
                  max="12"
                  value={dailyThreshold}
                  onChange={(e) => setDailyThreshold(e.target.value)}
                  placeholder="e.g., 8"
                />
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="warnOnly"
                checked={warnOnly}
                onCheckedChange={setWarnOnly}
              />
              <Label htmlFor="warnOnly">Warning only (don't prevent scheduling)</Label>
            </div>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{rule ? 'Edit Compliance Rule' : 'Add Compliance Rule'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ruleType">Rule Type</Label>
              <Select
                value={ruleType}
                onValueChange={(value) => setRuleType(value as ComplianceRuleType)}
                disabled={!!rule}
              >
                <SelectTrigger id="ruleType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RULE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {renderConfigFields()}

            <Separator />

            <div className="flex items-center space-x-2">
              <Switch
                id="enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              <Label htmlFor="enabled">Enable this rule</Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createRule.isPending || updateRule.isPending}>
              {rule ? 'Update' : 'Create'} Rule
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
