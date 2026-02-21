import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, Users, Clock, Briefcase, DollarSign, Percent } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TipSource, ShareMethod, SplitCadence, PoolingModel } from '@/hooks/useTipPoolSettings';
import type { TipContributionPool, CreatePoolInput, UpdatePoolInput } from '@/hooks/useTipContributionPools';
import type { Employee } from '@/types/scheduling';
import { ContributionPoolEditor } from './ContributionPoolEditor';

interface TipPoolSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  // Pooling model
  poolingModel: PoolingModel;
  onPoolingModelChange: (model: PoolingModel) => void;
  // Current settings
  tipSource: TipSource;
  shareMethod: ShareMethod;
  splitCadence: SplitCadence;
  roleWeights: Record<string, number>;
  selectedEmployees: Set<string>;
  // Available data
  eligibleEmployees: Employee[];
  isLoading?: boolean;
  // Callbacks
  onTipSourceChange: (value: TipSource) => void;
  onShareMethodChange: (value: ShareMethod) => void;
  onSplitCadenceChange: (value: SplitCadence) => void;
  onRoleWeightsChange: (weights: Record<string, number>) => void;
  onSelectedEmployeesChange: (employees: Set<string>) => void;
  // For percentage contribution mode
  contributionPools?: TipContributionPool[];
  onCreatePool?: (pool: CreatePoolInput) => Promise<TipContributionPool>;
  onUpdatePool?: (args: { id: string; updates: UpdatePoolInput }) => Promise<TipContributionPool>;
  onDeletePool?: (id: string) => Promise<void>;
  totalContributionPercentage?: number;
}

const defaultWeights: Record<string, number> = {
  'Server': 1,
  'Bartender': 1,
  'Runner': 0.8,
  'Host': 0.5,
  'Busser': 0.5,
};

export function TipPoolSettingsDialog({
  open,
  onClose,
  poolingModel,
  onPoolingModelChange,
  tipSource,
  shareMethod,
  splitCadence,
  roleWeights,
  selectedEmployees,
  eligibleEmployees,
  isLoading = false,
  onTipSourceChange,
  onShareMethodChange,
  onSplitCadenceChange,
  onRoleWeightsChange,
  onSelectedEmployeesChange,
  contributionPools,
  onCreatePool,
  onUpdatePool,
  onDeletePool,
  totalContributionPercentage,
}: TipPoolSettingsDialogProps) {
  // Local state for editing
  const [localRoleWeights, setLocalRoleWeights] = useState(roleWeights);

  // Sync local state when props change
  useEffect(() => {
    setLocalRoleWeights(roleWeights);
  }, [roleWeights]);

  // Get unique roles from eligible employees
  const uniqueRoles = [...new Set(eligibleEmployees.map(e => e.position).filter(Boolean))];

  const handleEmployeeToggle = (employeeId: string, checked: boolean) => {
    const newSelected = new Set(selectedEmployees);
    if (checked) {
      newSelected.add(employeeId);
    } else {
      newSelected.delete(employeeId);
    }
    onSelectedEmployeesChange(newSelected);
  };

  const handleSelectAll = () => {
    onSelectedEmployeesChange(new Set(eligibleEmployees.map(e => e.id)));
  };

  const handleSelectNone = () => {
    onSelectedEmployeesChange(new Set());
  };

  const handleRoleWeightChange = (role: string, weight: number) => {
    const newWeights = { ...localRoleWeights, [role]: weight };
    setLocalRoleWeights(newWeights);
    onRoleWeightsChange(newWeights);
  };

  const isFullPool = poolingModel === 'full_pool';
  const isPercentageContribution = poolingModel === 'percentage_contribution';

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tip Pool Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0 border-border/40">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-foreground" />
            </div>
            <div>
              <DialogTitle className="text-[17px] font-semibold text-foreground">Tip Pool Settings</DialogTitle>
              <DialogDescription className="text-[13px] mt-0.5">
                Configure how tips are collected, split, and distributed to your team.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-6">
          {/* Pooling Model (always shown first) */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                <Users className="h-3.5 w-3.5" />
                Pooling Model
              </h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                Choose how tips are pooled across your team.
              </p>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => onPoolingModelChange('full_pool')}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg border p-4 cursor-pointer transition-colors text-center',
                    isFullPool
                      ? 'border-foreground bg-foreground/5'
                      : 'border-border/40 hover:border-border'
                  )}
                >
                  <Users className="h-5 w-5 mb-2 text-foreground" />
                  <span className="text-[14px] font-medium">Full Pool</span>
                  <span className="text-[12px] text-muted-foreground mt-1">
                    All tips pooled and distributed to everyone
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onPoolingModelChange('percentage_contribution')}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-lg border p-4 cursor-pointer transition-colors text-center',
                    isPercentageContribution
                      ? 'border-foreground bg-foreground/5'
                      : 'border-border/40 hover:border-border'
                  )}
                >
                  <Percent className="h-5 w-5 mb-2 text-foreground" />
                  <span className="text-[14px] font-medium">Percentage Contribution</span>
                  <span className="text-[12px] text-muted-foreground mt-1">
                    Servers keep most tips, contribute % to pools
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Contribution Pool Editor (percentage_contribution only) */}
          {isPercentageContribution && contributionPools && onCreatePool && onUpdatePool && onDeletePool && (
            <ContributionPoolEditor
              pools={contributionPools}
              eligibleEmployees={eligibleEmployees}
              onCreatePool={onCreatePool}
              onUpdatePool={onUpdatePool}
              onDeletePool={onDeletePool}
              totalContributionPercentage={totalContributionPercentage ?? 0}
            />
          )}

          {/* Tip Source (full_pool only) */}
          {isFullPool && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                  <DollarSign className="h-3.5 w-3.5" />
                  Tip Source
                </h3>
              </div>
              <div className="p-4 space-y-3">
              <RadioGroup
                value={tipSource}
                onValueChange={(v) => onTipSourceChange(v as TipSource)}
                className="grid grid-cols-2 gap-4"
              >
                <Label
                  htmlFor="source-manual"
                  className={`flex flex-col items-center justify-center rounded-lg border p-4 cursor-pointer transition-colors ${
                    tipSource === 'manual' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                  }`}
                >
                  <RadioGroupItem value="manual" id="source-manual" className="sr-only" />
                  <span className="text-[14px] font-medium">Manual Entry</span>
                  <span className="text-[12px] text-muted-foreground text-center mt-1">
                    Enter tip amounts manually each day
                  </span>
                </Label>
                <Label
                  htmlFor="source-pos"
                  className={`flex flex-col items-center justify-center rounded-lg border p-4 cursor-pointer transition-colors ${
                    tipSource === 'pos' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                  }`}
                >
                  <RadioGroupItem value="pos" id="source-pos" className="sr-only" />
                  <span className="text-[14px] font-medium">POS Import</span>
                  <span className="text-[12px] text-muted-foreground text-center mt-1">
                    Import tips automatically from your POS
                  </span>
                </Label>
              </RadioGroup>
              </div>
            </div>
          )}

          {/* Share Method (full_pool only) */}
          {isFullPool && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground flex items-center gap-2">
                  <Users className="h-3.5 w-3.5" />
                  Share Method
                </h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  How should tips be divided among employees?
                </p>
              </div>
              <div className="p-4 space-y-2">
              <RadioGroup
                value={shareMethod}
                onValueChange={(v) => onShareMethodChange(v as ShareMethod)}
                className="space-y-2"
              >
                <Label
                  htmlFor="method-hours"
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    shareMethod === 'hours' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                  }`}
                >
                  <RadioGroupItem value="hours" id="method-hours" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span className="text-[14px] font-medium">By Hours Worked</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">Recommended</span>
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      Tips are split proportionally based on hours worked. More hours = bigger share.
                    </p>
                  </div>
                </Label>

                <Label
                  htmlFor="method-role"
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    shareMethod === 'role' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                  }`}
                >
                  <RadioGroupItem value="role" id="method-role" className="mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      <span className="text-[14px] font-medium">By Role</span>
                    </div>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      Tips are split based on role weights. Servers and bartenders can get larger shares.
                    </p>
                  </div>
                </Label>

                <Label
                  htmlFor="method-manual"
                  className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                    shareMethod === 'manual' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                  }`}
                >
                  <RadioGroupItem value="manual" id="method-manual" className="mt-1" />
                  <div className="flex-1">
                    <span className="text-[14px] font-medium">Even Split</span>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      Tips are split evenly among all participating employees.
                    </p>
                  </div>
                </Label>
              </RadioGroup>
              </div>
            </div>
          )}

          {/* Role Weights (full_pool + role method only) */}
          {isFullPool && shareMethod === 'role' && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
                <h3 className="text-[13px] font-semibold text-foreground">Role Weights</h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Adjust how much each role receives. Higher weight = larger share.
                </p>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  {uniqueRoles.map(role => (
                    <div key={role} className="flex items-center gap-3">
                      <Label htmlFor={`weight-${role}`} className="w-24 text-sm">
                        {role}
                      </Label>
                      <Input
                        id={`weight-${role}`}
                        type="number"
                        step="0.1"
                        min="0"
                        max="10"
                        value={localRoleWeights[role] ?? defaultWeights[role] ?? 1}
                        onChange={(e) => handleRoleWeightChange(role, parseFloat(e.target.value) || 0)}
                        className="w-20"
                      />
                    </div>
                  ))}
                </div>
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    Example: If Server = 1.0 and Busser = 0.5, servers get twice as much per person.
                  </AlertDescription>
                </Alert>
              </div>
            </div>
          )}

          {/* Split Cadence (always shown) */}
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-muted/50">
              <h3 className="text-[13px] font-semibold text-foreground">Split Cadence</h3>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                How often should tips be calculated and distributed?
              </p>
            </div>
            <div className="p-4">
            <RadioGroup
              value={splitCadence}
              onValueChange={(v) => onSplitCadenceChange(v as SplitCadence)}
              className="grid grid-cols-3 gap-4"
            >
              <Label
                htmlFor="cadence-daily"
                className={`flex flex-col items-center justify-center rounded-lg border p-3 cursor-pointer transition-colors ${
                  splitCadence === 'daily' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                }`}
              >
                <RadioGroupItem value="daily" id="cadence-daily" className="sr-only" />
                <span className="text-[14px] font-medium">Daily</span>
                <span className="text-[12px] text-muted-foreground">Every day</span>
              </Label>
              <Label
                htmlFor="cadence-weekly"
                className={`flex flex-col items-center justify-center rounded-lg border p-3 cursor-pointer transition-colors ${
                  splitCadence === 'weekly' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                }`}
              >
                <RadioGroupItem value="weekly" id="cadence-weekly" className="sr-only" />
                <span className="text-[14px] font-medium">Weekly</span>
                <span className="text-[12px] text-muted-foreground">Once a week</span>
              </Label>
              <Label
                htmlFor="cadence-shift"
                className={`flex flex-col items-center justify-center rounded-lg border p-3 cursor-pointer transition-colors ${
                  splitCadence === 'shift' ? 'border-foreground bg-foreground/5' : 'border-border/40 hover:border-border'
                }`}
              >
                <RadioGroupItem value="shift" id="cadence-shift" className="sr-only" />
                <span className="text-[14px] font-medium">Per Shift</span>
                <span className="text-[12px] text-muted-foreground">Each shift</span>
              </Label>
            </RadioGroup>
            </div>
          </div>

          {/* Eligible Employees (full_pool only) */}
          {isFullPool && (
            <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
              <div className="px-4 py-3 border-b border-border/40 bg-muted/50 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-foreground">Participating Employees</h3>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={handleSelectAll} className="h-7 text-[12px]">
                    Select All
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleSelectNone} className="h-7 text-[12px]">
                    Select None
                  </Button>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-[13px] text-muted-foreground">
                  Choose which employees participate in tip pooling.
                </p>
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-border/40 rounded-xl p-3">
                  {eligibleEmployees.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground col-span-2">
                      No eligible employees found. Salaried employees are excluded.
                    </p>
                  ) : (
                    eligibleEmployees.map(employee => (
                      <Label
                        key={employee.id}
                        className="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={selectedEmployees.has(employee.id)}
                          onCheckedChange={(checked) => handleEmployeeToggle(employee.id, !!checked)}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-[14px] font-medium truncate block">{employee.name}</span>
                          <span className="text-[12px] text-muted-foreground">{employee.position}</span>
                        </div>
                      </Label>
                    ))
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {selectedEmployees.size} of {eligibleEmployees.length} employees selected
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border/40">
          <Button variant="outline" onClick={onClose} className="h-9 rounded-lg text-[13px] font-medium">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
