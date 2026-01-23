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
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Info, Users, Clock, Briefcase, DollarSign } from 'lucide-react';
import type { TipSource, ShareMethod, SplitCadence } from '@/hooks/useTipPoolSettings';
import type { Employee } from '@/types/scheduling';

interface TipPoolSettingsDialogProps {
  open: boolean;
  onClose: () => void;
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tip Pool Settings</DialogTitle>
          <DialogDescription>
            Configure how tips are collected, split, and distributed to your team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Tip Source */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Tip Source</Label>
            </div>
            <RadioGroup
              value={tipSource}
              onValueChange={(v) => onTipSourceChange(v as TipSource)}
              className="grid grid-cols-2 gap-4"
            >
              <Label
                htmlFor="source-manual"
                className={`flex flex-col items-center justify-center rounded-md border-2 p-4 cursor-pointer hover:bg-accent ${
                  tipSource === 'manual' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="manual" id="source-manual" className="sr-only" />
                <span className="font-medium">Manual Entry</span>
                <span className="text-xs text-muted-foreground text-center mt-1">
                  Enter tip amounts manually each day
                </span>
              </Label>
              <Label
                htmlFor="source-pos"
                className={`flex flex-col items-center justify-center rounded-md border-2 p-4 cursor-pointer hover:bg-accent ${
                  tipSource === 'pos' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="pos" id="source-pos" className="sr-only" />
                <span className="font-medium">POS Import</span>
                <span className="text-xs text-muted-foreground text-center mt-1">
                  Import tips automatically from your POS
                </span>
              </Label>
            </RadioGroup>
          </div>

          <Separator />

          {/* Share Method */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <Label className="text-base font-medium">Share Method</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              How should tips be divided among employees?
            </p>
            <RadioGroup
              value={shareMethod}
              onValueChange={(v) => onShareMethodChange(v as ShareMethod)}
              className="space-y-2"
            >
              <Label
                htmlFor="method-hours"
                className={`flex items-start gap-3 rounded-md border-2 p-4 cursor-pointer hover:bg-accent ${
                  shareMethod === 'hours' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="hours" id="method-hours" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span className="font-medium">By Hours Worked</span>
                    <Badge variant="secondary" className="text-xs">Recommended</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tips are split proportionally based on hours worked. More hours = bigger share.
                  </p>
                </div>
              </Label>

              <Label
                htmlFor="method-role"
                className={`flex items-start gap-3 rounded-md border-2 p-4 cursor-pointer hover:bg-accent ${
                  shareMethod === 'role' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="role" id="method-role" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    <span className="font-medium">By Role</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tips are split based on role weights. Servers and bartenders can get larger shares.
                  </p>
                </div>
              </Label>

              <Label
                htmlFor="method-manual"
                className={`flex items-start gap-3 rounded-md border-2 p-4 cursor-pointer hover:bg-accent ${
                  shareMethod === 'manual' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="manual" id="method-manual" className="mt-1" />
                <div className="flex-1">
                  <span className="font-medium">Even Split</span>
                  <p className="text-sm text-muted-foreground mt-1">
                    Tips are split evenly among all participating employees.
                  </p>
                </div>
              </Label>
            </RadioGroup>
          </div>

          {/* Role Weights (only shown when share method is 'role') */}
          {shareMethod === 'role' && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-base font-medium">Role Weights</Label>
                <p className="text-sm text-muted-foreground">
                  Adjust how much each role receives. Higher weight = larger share.
                </p>
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
            </>
          )}

          <Separator />

          {/* Split Cadence */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Split Cadence</Label>
            <p className="text-sm text-muted-foreground">
              How often should tips be calculated and distributed?
            </p>
            <RadioGroup
              value={splitCadence}
              onValueChange={(v) => onSplitCadenceChange(v as SplitCadence)}
              className="grid grid-cols-3 gap-4"
            >
              <Label
                htmlFor="cadence-daily"
                className={`flex flex-col items-center justify-center rounded-md border-2 p-3 cursor-pointer hover:bg-accent ${
                  splitCadence === 'daily' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="daily" id="cadence-daily" className="sr-only" />
                <span className="font-medium">Daily</span>
                <span className="text-xs text-muted-foreground">Every day</span>
              </Label>
              <Label
                htmlFor="cadence-weekly"
                className={`flex flex-col items-center justify-center rounded-md border-2 p-3 cursor-pointer hover:bg-accent ${
                  splitCadence === 'weekly' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="weekly" id="cadence-weekly" className="sr-only" />
                <span className="font-medium">Weekly</span>
                <span className="text-xs text-muted-foreground">Once a week</span>
              </Label>
              <Label
                htmlFor="cadence-shift"
                className={`flex flex-col items-center justify-center rounded-md border-2 p-3 cursor-pointer hover:bg-accent ${
                  splitCadence === 'shift' ? 'border-primary bg-primary/5' : 'border-muted'
                }`}
              >
                <RadioGroupItem value="shift" id="cadence-shift" className="sr-only" />
                <span className="font-medium">Per Shift</span>
                <span className="text-xs text-muted-foreground">Each shift</span>
              </Label>
            </RadioGroup>
          </div>

          <Separator />

          {/* Eligible Employees */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Participating Employees</Label>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={handleSelectAll}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={handleSelectNone}>
                  Select None
                </Button>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              Choose which employees participate in tip pooling.
            </p>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto border rounded-md p-3">
              {eligibleEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground col-span-2">
                  No eligible employees found. Salaried employees are excluded.
                </p>
              ) : (
                eligibleEmployees.map(employee => (
                  <Label
                    key={employee.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-accent cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedEmployees.has(employee.id)}
                      onCheckedChange={(checked) => handleEmployeeToggle(employee.id, !!checked)}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{employee.name}</span>
                      <span className="text-xs text-muted-foreground">{employee.position}</span>
                    </div>
                  </Label>
                ))
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedEmployees.size} of {eligibleEmployees.length} employees selected
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
